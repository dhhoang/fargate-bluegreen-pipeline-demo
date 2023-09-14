import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codeBuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as codePipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codePipelineActions from 'aws-cdk-lib/aws-codepipeline-actions';

export interface DeploymentPipelineStackProps extends cdk.StackProps {
  servicePrefix: string;
  codeStarConnectionArn: string;
  gitBranch: string;
  ecrRepoUri: string;
}

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DeploymentPipelineStackProps) {
    super(scope, id, props);

    const buildArtifactBucket = new s3.Bucket(this, `${props.servicePrefix}BuildArtifactBucket`, {
      bucketName: `${props.servicePrefix}Pipeline-${props?.env?.account}-${props?.env?.region}`.toLowerCase(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      // configure lifecycle rules: move to glacier after 7 days, delete after 30 days
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
          expiration: cdk.Duration.days(30),
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(7),
            },
          ],
        },
      ]
    });

    const sourceArtifact = new codePipeline.Artifact('sourceArtifact');
    const buildArtifact = new codePipeline.Artifact('buildArtifact');

    const codeBuildProject = new codeBuild.PipelineProject(this, 'ContainerBuildProject', {
      projectName: `${props.servicePrefix}ContainerBuild`,
      buildSpec: codeBuild.BuildSpec.fromSourceFilename('aws/buildspec.yaml'),
      environment: {
        privileged: true,
        buildImage: codeBuild.LinuxBuildImage.STANDARD_7_0,
      },
      environmentVariables: {
        'ECR_REPO_URI': {
          type: codeBuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: props.ecrRepoUri,
        },
      },
    });

    codeBuildProject.role?.addManagedPolicy(new iam.ManagedPolicy(this, 'ContainerBuildExtraPermissions', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowECRPush',
          effect: iam.Effect.ALLOW,
          actions: [
            'ecr:BatchCheckLayerAvailability',
            'ecr:CompleteLayerUpload',
            'ecr:GetAuthorizationToken',
            'ecr:InitiateLayerUpload',
            'ecr:PutImage',
            'ecr:UploadLayerPart'
          ],
          resources: ['*']
        })
      ]
    }));

    // Code Pipeline - CloudWatch trigger event is created by CDK
    const pipeline = new codePipeline.Pipeline(this, 'ecsBlueGreen', {
      artifactBucket: buildArtifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codePipelineActions.CodeStarConnectionsSourceAction({
              actionName: 'BitBucketSource',
              owner: 'huyhdpixelz',
              repo: 'video-poc',
              output: sourceArtifact,
              connectionArn: props.codeStarConnectionArn,
              branch: props.gitBranch,
            }),
          ]
        },
        {
          stageName: 'Build',
          actions: [
            new codePipelineActions.CodeBuildAction({
              actionName: 'BuildContainer',
              project: codeBuildProject,
              input: sourceArtifact,
              outputs: [buildArtifact]
            })
          ]
        },
        // {
        //   stageName: 'DeployTest',
        //   actions: [
        //     new codePipelineActions.EcsDeployAction({
        //       actionName: 'DeployTest',
        //       service: ecs.FargateService.fromFargateServiceAttributes(this, 'FargateSvcImport', {
        //         cluster: ecs.Cluster.fromClusterArn(this, 'FargateClusterImport', 'arn:aws:ecs:ap-southeast-1:694500861348:cluster/AppTest'),
        //         // serviceName: 'AppTestSvc',
        //         serviceArn: 'arn:aws:ecs:ap-southeast-1:694500861348:cluster/AppTest/asdsadasd'
        //       }),
        //       imageFile: new codePipeline.ArtifactPath(buildArtifact, 'imagedefinitions.json')
        //     })
        //   ]
        // }
      ]
    });

    pipeline.role.attachInlinePolicy(new iam.Policy(this, 'CodeBuildPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'iam:PassRole',
            'sts:AssumeRole',
            'codebuild:BatchGetBuilds',
            'codebuild:StartBuild',
            'codedeploy:CreateDeployment',
            'codedeploy:Get*',
            'codedeploy:RegisterApplicationRevision',
            's3:Get*',
            's3:List*',
            's3:PutObject'
          ],
          resources: ['*']
        })
      ]
    }));
  }
}
