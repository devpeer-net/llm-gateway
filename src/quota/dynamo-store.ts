import {
  ConditionalCheckFailedException,
  GetItemCommand,
  GetItemCommandOutput,
  PutItemCommand,
  PutItemCommandInput,
  ReturnValue,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { ApiType, ApiUsage, Period, SubscriptionPlan } from '../types';
import { config } from '../config';
import dynamoDbClient from './dynamo-client';
import {
  kDefaultMonthlyQuota,
  kPeriodSeconds,
  NoUsageRecordError,
  QuotaStore,
} from './quota-store';

const API_USAGE_TABLE = config.quota.apiUsageTable;

const dbItemToApiUsage = (item: any): ApiUsage => ({
  userId: item.userId.S,
  apiType: item.apiType.S,
  plan: item.plan?.S,
  bonusCredits: item.bonusCredits?.N ? Number(item.bonusCredits.N) : 0,
  createdAt: item.createdAt!.S,
  lastRequestAt: item.lastRequestAt?.S ?? null,
  period: item.period?.S,
  periodSeconds: Number(item.periodSeconds!.N),
  periodStart: item.periodStart!.S,
  quota: Number(item.quota!.N),
  updatedAt: item.updatedAt!.S,
  usageCount: Number(item.usageCount!.N),
  requests:
    item.requests?.L?.map((record: any) => {
      if (
        record &&
        typeof record === 'object' &&
        record.M &&
        record.M.usage?.N !== undefined &&
        record.M.timestamp?.N !== undefined
      ) {
        return {
          usage: Number(record.M.usage.N),
          timestamp: Number(record.M.timestamp.N),
        };
      }
      return null;
    }).filter((r: any) => r !== null) || [],
});

/**
 * DynamoDB-backed quota store. Wraps the item-level persistence logic and
 * exposes it through the backend-agnostic {@link QuotaStore} interface.
 */
export class DynamoQuotaStore implements QuotaStore {
  async getUserQuota(userId: string, apiType: ApiType): Promise<ApiUsage> {
    const result: GetItemCommandOutput = await dynamoDbClient.send(
      new GetItemCommand({
        TableName: API_USAGE_TABLE,
        Key: {
          userId: { S: userId },
          apiType: { S: apiType },
        },
      })
    );

    if (!result.Item) {
      throw new NoUsageRecordError(userId, apiType);
    }
    return dbItemToApiUsage(result.Item);
  }

  private async recordApiUsage(userId: string, apiType: ApiType, usedCredits: number): Promise<void> {
    const now = Date.now();
    const newRequest = {
      M: {
        usage: { N: usedCredits.toString() },
        timestamp: { N: now.toString() },
      },
    };

    await dynamoDbClient.send(
      new UpdateItemCommand({
        TableName: API_USAGE_TABLE,
        Key: {
          userId: { S: userId },
          apiType: { S: apiType },
        },
        UpdateExpression:
          'SET #requests = list_append(if_not_exists(#requests, :emptyList), :newRequest), #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#requests': 'requests',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':newRequest': { L: [newRequest] },
          ':emptyList': { L: [] },
          ':updatedAt': { S: new Date().toISOString() },
        },
      })
    );
  }

  async updateApiUsage(userId: string, apiType: ApiType, usedCredits: number): Promise<void> {
    this.recordApiUsage(userId, apiType, usedCredits).catch((error) => {
      console.error('Error recording API usage:', error);
    });

    const updateBonusCreditsParams = {
      TableName: API_USAGE_TABLE,
      Key: {
        userId: { S: userId },
        apiType: { S: apiType },
      },
      UpdateExpression: 'SET bonusCredits = bonusCredits - :usedCredits, lastRequestAt = :now',
      ConditionExpression: 'bonusCredits >= :usedCredits',
      ExpressionAttributeValues: {
        ':usedCredits': { N: String(usedCredits) },
        ':now': { S: new Date().toISOString() },
      },
      ReturnValues: ReturnValue.ALL_NEW,
    };

    try {
      await dynamoDbClient.send(new UpdateItemCommand(updateBonusCreditsParams));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        // Not enough bonus credits — increment the usage counter instead.
        await dynamoDbClient.send(
          new UpdateItemCommand({
            TableName: API_USAGE_TABLE,
            Key: {
              userId: { S: userId },
              apiType: { S: apiType },
            },
            UpdateExpression:
              'SET usageCount = if_not_exists(usageCount, :start) + :inc, lastRequestAt = :now',
            ExpressionAttributeValues: {
              ':inc': { N: String(usedCredits) },
              ':now': { S: new Date().toISOString() },
              ':start': { N: '0' },
            },
            ReturnValues: ReturnValue.ALL_NEW,
          })
        );
      } else {
        throw error;
      }
    }
  }

  async resetQuota(userId: string, apiUsage: ApiUsage): Promise<void> {
    const now = new Date();
    const lastPeriodStart = new Date(apiUsage.periodStart);
    const periodsCount = Math.floor(
      (now.getTime() - lastPeriodStart.getTime()) / (kPeriodSeconds[apiUsage.period] * 1000)
    );
    const newPeriodStart = new Date(
      lastPeriodStart.getTime() + periodsCount * kPeriodSeconds[apiUsage.period] * 1000
    );

    await dynamoDbClient.send(
      new UpdateItemCommand({
        TableName: API_USAGE_TABLE,
        Key: {
          userId: { S: userId },
          apiType: { S: apiUsage.apiType },
        },
        UpdateExpression: 'SET usageCount = :start, updatedAt = :now, periodStart = :newPeriodStart',
        ExpressionAttributeValues: {
          ':start': { N: '0' },
          ':now': { S: new Date().toISOString() },
          ':newPeriodStart': { S: newPeriodStart.toISOString() },
        },
        ReturnValues: ReturnValue.ALL_NEW,
      })
    );
  }

  async provisionQuota(userId: string, apiType: ApiType): Promise<ApiUsage> {
    const currentDateStr = new Date().toISOString();
    const apiUsage: ApiUsage = {
      userId,
      apiType,
      plan: SubscriptionPlan.FREE,
      usageCount: 0,
      quota: kDefaultMonthlyQuota,
      period: Period.MONTH,
      periodSeconds: kPeriodSeconds[Period.MONTH],
      periodStart: currentDateStr,
      bonusCredits: 0,
      lastRequestAt: null,
      createdAt: currentDateStr,
      updatedAt: currentDateStr,
    };

    const params: PutItemCommandInput = {
      TableName: API_USAGE_TABLE,
      Item: {
        userId: { S: apiUsage.userId },
        apiType: { S: apiUsage.apiType },
        plan: { S: apiUsage.plan },
        usageCount: { N: apiUsage.usageCount.toString() },
        quota: { N: apiUsage.quota.toString() },
        period: { S: apiUsage.period },
        periodSeconds: { N: apiUsage.periodSeconds.toString() },
        periodStart: { S: apiUsage.periodStart },
        bonusCredits: { N: apiUsage.bonusCredits.toString() },
        createdAt: { S: apiUsage.createdAt },
        updatedAt: { S: apiUsage.updatedAt },
      },
      ConditionExpression: 'attribute_not_exists(userId)',
    };

    await dynamoDbClient.send(new PutItemCommand(params));
    return apiUsage;
  }
}
