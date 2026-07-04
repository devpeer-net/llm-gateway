import {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources';
import OpenAI from 'openai';
import {
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming';

export const generateOpenAI = async (
  openAI: OpenAI,
  params: ChatCompletionCreateParamsBase,
  isOpenrouter: boolean,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean,
  includeUsage: boolean = true
): Promise<ChatCompletion> => {
  let payload: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming | any = {
    ...params,
    stream: generateCallback ? true : false,
  };

  if (payload.stream && includeUsage) {
    payload.stream_options = {
      include_usage: true,
    };
  }

  // OpenRouter-specific provider routing hints.
  if (isOpenrouter) {
    payload.provider = {
      data_collection: 'deny',
      sort: 'latency',
    };
  }

  return payload.stream
    ? await handleGenerateStream(openAI, payload as ChatCompletionCreateParamsStreaming, generateCallback!)
    : await handleGenerate(openAI, payload as ChatCompletionCreateParamsNonStreaming);
};

const handleGenerate = async (
  openAI: OpenAI,
  payload: ChatCompletionCreateParamsNonStreaming
): Promise<ChatCompletion> => {
  return openAI.chat.completions.create(payload);
};

export const aggregateToolCalls = (
  tool_calls: Array<ChatCompletionChunk.Choice.Delta.ToolCall>,
  new_chunks: Array<ChatCompletionChunk.Choice.Delta.ToolCall>
): Array<ChatCompletionChunk.Choice.Delta.ToolCall> => {
  if (new_chunks.length === 0) {
    return tool_calls;
  }

  try {
    for (const new_chunk of new_chunks) {
      const existing_tool_call = tool_calls.find(
        (tc) => tc.index !== undefined && tc.index === new_chunk.index
      );
      if (!existing_tool_call) {
        tool_calls.push(new_chunk);
        continue;
      }
      if (existing_tool_call.function) {
        existing_tool_call.function.arguments += new_chunk.function?.arguments || '';
      } else {
        existing_tool_call.function = new_chunk.function;
      }
    }
  } finally {
    return tool_calls;
  }
};

export const addToolCalls = (
  chunk: ChatCompletionChunk,
  tool_calls: Array<ChatCompletionChunk.Choice.Delta.ToolCall>
) => {
  try {
    if (tool_calls.length > 0) {
      if (chunk.choices.length > 0) {
        chunk.choices[0].delta.tool_calls = tool_calls;
      } else {
        chunk.choices.push({
          delta: {
            tool_calls: tool_calls,
          },
          finish_reason: 'function_call',
          index: 0,
        });
      }
    }
  } catch (error: any) {
    throw new Error(`Error adding tool calls: ${error.message}`);
  }
};

const estimatePayloadTokens = (messages: ChatCompletionMessageParam[]): number => {
  let charsCount = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      charsCount += message.content.length;
    } else if (Array.isArray(message.content)) {
      charsCount += message.content
        .map((content: any) => content.text)
        .reduce((acc: number, text: string) => acc + (text?.length || 0), 0);
    }
  }
  return charsCount / 3;
};

const handleGenerateStream = async (
  openAI: OpenAI,
  payload: ChatCompletionCreateParamsStreaming,
  generateCallback: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  const stream: Stream<ChatCompletionChunk> = await openAI.chat.completions.create(payload);
  let lastChunk: ChatCompletionChunk | undefined;
  let tool_calls: Array<ChatCompletionChunk.Choice.Delta.ToolCall> = [];
  let shouldContinue = true;
  let streamedContent = '';
  for await (const chunk of stream) {
    lastChunk = chunk;
    tool_calls = aggregateToolCalls(tool_calls, chunk.choices[0]?.delta?.tool_calls || []);
    streamedContent += chunk.choices[0]?.delta?.content || '';
    shouldContinue = generateCallback(chunk);
    if (!shouldContinue) {
      break;
    }
  }

  if (!shouldContinue) {
    stream.controller.abort();
  }

  if (!lastChunk) {
    throw new Error('Stream ended without any chunks');
  }

  // Attach aggregated tool calls to the last message.
  addToolCalls(lastChunk, tool_calls);

  let usage = lastChunk.usage;
  if (!usage) {
    const estimatedPayloadTokens = estimatePayloadTokens(payload.messages);
    usage = {
      // Estimate 3 characters per token.
      prompt_tokens: estimatedPayloadTokens,
      completion_tokens: streamedContent.length / 3,
      total_tokens: estimatedPayloadTokens + streamedContent.length / 3,
    };
  }

  const choices: Array<ChatCompletion.Choice> =
    lastChunk.choices && lastChunk.choices.length > 0
      ? [
          {
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
            message: {
              content: !shouldContinue ? streamedContent : lastChunk.choices[0].delta.content ?? null,
              refusal: null,
              role: 'assistant',
              tool_calls: !shouldContinue
                ? (tool_calls as ChatCompletionMessageToolCall[])
                : (lastChunk.choices[0].delta.tool_calls as ChatCompletionMessageToolCall[]),
            },
          },
        ]
      : [];
  return {
    id: lastChunk.id,
    created: Math.floor(Date.now() / 1000),
    model: payload.model,
    object: 'chat.completion',
    choices: choices,
    usage: {
      prompt_tokens: (usage as any).promptTokens ? (usage! as any).promptTokens : usage!.prompt_tokens,
      completion_tokens: (usage as any).completionTokens
        ? (usage! as any).completionTokens
        : usage!.completion_tokens,
      total_tokens: (usage as any).totalTokens ? (usage! as any).totalTokens : usage!.total_tokens,
    },
  };
};
