// import { Construct } from 'constructs';
// import * as cdk from 'aws-cdk-lib';
// import * as iam from 'aws-cdk-lib/aws-iam';
// import * as codeCommit from 'aws-cdk-lib/aws-codecommit';
// import * as ecr from 'aws-cdk-lib/aws-ecr';
// import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
// import * as codeBuild from 'aws-cdk-lib/aws-codebuild';
// import * as codeDeploy from 'aws-cdk-lib/aws-codedeploy';
// import * as s3 from 'aws-cdk-lib/aws-s3';
// import * as ecs from 'aws-cdk-lib/aws-ecs';
// import * as ec2 from 'aws-cdk-lib/aws-ec2';
// import * as codePipeline from 'aws-cdk-lib/aws-codepipeline';
// import * as codePipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';

// export class DeploymentPipelineStack extends cdk.Stack {
//   constructor(scope: Construct, id: string, props?: cdk.StackProps) {
//     super(scope, id, props);

//     const buildArtifactBucket = new s3.Bucket(scope, 'AppTestBuildArtifactBucket', {
//       bucketName: `AppTestPipeline-${props?.env?.account}-${props?.env?.region}`.toLowerCase(),
//       removalPolicy: cdk.RemovalPolicy.DESTROY,
//       autoDeleteObjects: true,
//       enforceSSL: true,
//       // configure lifecycle rules: move to glacier after 7 days, delete after 30 days
//       lifecycleRules: [
//         {
//           abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
//           expiration: cdk.Duration.days(30),
//           transitions: [
//             {
//               storageClass: s3.StorageClass.GLACIER,
//               transitionAfter: cdk.Duration.days(7),
//             },
//           ],
//         },
//       ]
//     });

//     // Code Pipeline - CloudWatch trigger event is created by CDK
//     const pipeline = new codePipeline.Pipeline(this, 'ecsBlueGreen', {
//       artifactBucket: buildArtifactBucket,
//       stages: [
//         {
//           stageName: 'Source',
//           actions: [
//             new codePipelineActions.CodeStarConnectionsSourceAction({
//               actionName: 'BitBucketSource',
//               owner: repoNameComponents[0],
//               repo: repoNameComponents[1],
//               output: srcOutput,
//               connectionArn: props.codestarConnectionArn,
//               branch: 'main',
//             }),
//           ]
//         },
//         {
//           stageName: 'Build',
//           actions: [
//             new codePipelineActions.CodeBuildAction({
//               actionName: 'Build',
//               project: codeBuildProject,
//               input: sourceArtifact,
//               outputs: [buildArtifact]
//             })
//           ]
//         },
//         {
//           stageName: 'Deploy',
//           actions: [
//             new codePipelineActions.CodeDeployEcsDeployAction({
//               actionName: 'Deploy',
//               deploymentGroup: ecsBlueGreenDeploymentGroup.ecsDeploymentGroup,
//               appSpecTemplateInput: buildArtifact,
//               taskDefinitionTemplateInput: buildArtifact,
//             })
//           ]
//         }
//       ]
//     });

//     new codePipelineActions.ecs({
//       actionName: 'dsad',
//       imageFile
//     });

//     pipeline.role.attachInlinePolicy(new iam.Policy(this, 'CodeBuildPolicy', {
//       statements: [
//         new iam.PolicyStatement({
//           effect: iam.Effect.ALLOW,
//           actions: [
//             'iam:PassRole',
//             'sts:AssumeRole',
//             'codecommit:Get*',
//             'codecommit:List*',
//             'codecommit:GitPull',
//             'codecommit:UploadArchive',
//             'codecommit:CancelUploadArchive',
//             'codebuild:BatchGetBuilds',
//             'codebuild:StartBuild',
//             'codedeploy:CreateDeployment',
//             'codedeploy:Get*',
//             'codedeploy:RegisterApplicationRevision',
//             's3:Get*',
//             's3:List*',
//             's3:PutObject'
//           ],
//           resources: ['*']
//         })
//       ]
//     }));
//   }
// }
