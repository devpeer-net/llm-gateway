import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { config } from '../config';

// Only imported when the DynamoDB quota store is selected (see quota-store factory).
const dynamoDbClient = new DynamoDBClient({ region: config.quota.awsRegion });

export default dynamoDbClient;
