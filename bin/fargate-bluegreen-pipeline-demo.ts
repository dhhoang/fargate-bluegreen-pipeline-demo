#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FargateStack } from '../lib/fargate-stack';
import { DeploymentPipelineStack } from '../lib/pipeline-stack';

const servicePrefix = 'Centauri';
const ecrRepoUri = '694500861348.dkr.ecr.ap-southeast-2.amazonaws.com/apptest';
const app = new cdk.App();
const testStack = new FargateStack(app, `${servicePrefix}FargateStack`, {
  servicePrefix: servicePrefix,
  env: {
    account: '694500861348',
    region: 'ap-southeast-1'
  }
});

const pipelineStack = new DeploymentPipelineStack(app, `${servicePrefix}PipelineStack`, {
  crossRegionReferences: true,
  servicePrefix: servicePrefix,
  codeStarConnectionArn: 'arn:aws:codestar-connections:ap-southeast-2:694500861348:connection/4740d9d7-fbf3-4758-bb87-532a50ff8011',
  gitBranch: 'cdk-test',
  ecrRepoUri: ecrRepoUri,
  env: {
    account: '694500861348',
    region: 'ap-southeast-2'
  }
});
