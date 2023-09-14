import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cwLogs from 'aws-cdk-lib/aws-logs';
import * as codeDeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ecr from 'aws-cdk-lib/aws-ecr';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface FargateStackProps extends cdk.StackProps {
  importVpcId?: string;
  importSecGroupId?: string;
  servicePrefix: string;
}

export class FargateStack extends cdk.Stack {
  public readonly fargateService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: FargateStackProps) {
    super(scope, id, props);

    //1. Create VPC
    // TODO import?
    const vpc = props.importVpcId
      ? ec2.Vpc.fromLookup(this, 'VpcImport', {
        vpcId: props.importVpcId
      })
      : new ec2.Vpc(this, 'SharedVpc', {
        maxAzs: 1,
      });

    const secGroup = props.importSecGroupId
      ? ec2.SecurityGroup.fromLookupById(this, 'SecGroupImport', props.importSecGroupId)
      : new ec2.SecurityGroup(this, 'ServiceSecGroup', {
        securityGroupName: 'apptest-sg',
        vpc: vpc,
        allowAllOutbound: true
      });

    //2. Creation of Execution Role for our task
    const execRole = new iam.Role(this, 'ExecAndContainerRole', {
      roleName: `${props.servicePrefix}AppTestECSDeploymentRole`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    execRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'ExecRoleECSPolicy', 'arn:aws:iam::aws:policy/AWSCodeDeployRoleForECS'));

    //3. Adding permissions to the above created role...basically giving permissions to ECR image and Cloudwatch logs
    execRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'logs:CreateLogStream',
        'logs:PutLogEvents',

        // SSM access
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel'
      ],
      effect: iam.Effect.ALLOW,
      resources: ['*']
    }));

    //4. Create the ECS fargate cluster
    const cluster = new ecs.Cluster(this, 'FargateCluster', {
      vpc: vpc,
      clusterName: `${props.servicePrefix}Fargate`
    });

    //5. Create a task definition for our cluster to invoke a task
    const taskDef = new ecs.FargateTaskDefinition(this, 'FargateTaskDef', {
      family: props.servicePrefix,
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: execRole,
      taskRole: execRole,   // TODO separate this from exec role
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64
      }
    });

    //6. Create log group for our task to put logs
    const logGroup = new cwLogs.LogGroup(this, 'ServiceLogGroup', {
      logGroupName: `/${props.servicePrefix}`,
      retention: cwLogs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const logDriver = new ecs.AwsLogDriver({
      logGroup: logGroup,
      streamPrefix: 'fargate'
    });

    //7. Create container for the task definition from ECR image
    // TODO logging?
    const container = taskDef.addContainer('ServerContainer', {
      containerName: 'main',
      essential: true,
      logging: logDriver,
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryArn(this, 'EcrRepoImport', 'arn:aws:ecr:ap-southeast-2:694500861348:repository/apptest'),
        'latest'),
      environment: {
        'ASPNETCORE_URLS': 'http://0.0.0.0:80'
      }
    });

    //8. Add port mappings to your container...Make sure you use TCP protocol for Network Load Balancer (NLB)
    container.addPortMappings({
      containerPort: 80,
      hostPort: 80,
      protocol: ecs.Protocol.TCP
    });

    //9. Create the NLB using the above VPC.
    const loadBalancer = new elb.NetworkLoadBalancer(this, 'ServiceNLB', {
      loadBalancerName: `${props.servicePrefix}-nlb`,
      vpc: vpc,
      internetFacing: true,
    });

    //10. Add a PROD listener (blue) on a particular port for the NLB
    const prodListener = loadBalancer.addListener('NLBProdListener', {
      port: 80,
    });
    // // Add a TEST listener (green)
    // const testListener = loadBalancer.addListener('NLBTestListener', {
    //   port: 8080,
    // });

    // set sec group to NLB as work-around: https://github.com/aws/aws-cdk/issues/26735
    const cfnlb = (loadBalancer.node.defaultChild as elb.CfnLoadBalancer);
    cfnlb.addPropertyOverride('SecurityGroups', [
      secGroup.securityGroupId,
    ]);

    //12. Add IngressRule to access the docker image on 80
    secGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP anywhere');
    secGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'HTTP anywhere');
    secGroup.addIngressRule(secGroup, ec2.Port.allTraffic(), 'In-group traffic');

    this.fargateService = new ecs.FargateService(this, 'ECSService', {
      cluster: cluster,
      securityGroups: [secGroup],
      taskDefinition: taskDef,
      healthCheckGracePeriod: cdk.Duration.seconds(10),
      desiredCount: 1,
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS
      },
      circuitBreaker: {
        rollback: true
      },
      serviceName: `${props.servicePrefix}-svc`
    });

    prodListener.addTargets('NLBTargetGroup', {
      port: 80,
      targets: [this.fargateService],
      targetGroupName: `${props.servicePrefix}Target`,
      healthCheck: {
        enabled: true,
        healthyHttpCodes: '200-399',
        healthyThresholdCount: 2,
        interval: cdk.Duration.seconds(15),
        path: '/',
        port: '80',
        protocol: elb.Protocol.HTTP,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(10),
      },
      protocol: elb.Protocol.TCP,
    });

    // TODO this.fargateService.autoScaleTaskCount()

    // const greenTargetGroup = new elb.NetworkTargetGroup(this, 'GreenTargetGroup', {
    //   port: 80,
    //   targetType: elb.TargetType.IP,
    //   targets: [],
    //   targetGroupName: 'AppTestGreenTg2',
    //   deregistrationDelay: cdk.Duration.seconds(60),
    //   vpc: vpc,
    //   protocol: elb.Protocol.TCP,
    //   healthCheck: {
    //     enabled: true,
    //     healthyHttpCodes: '200-399',
    //     healthyThresholdCount: 2,
    //     interval: cdk.Duration.seconds(15),
    //     path: '/',
    //     port: '80',
    //     protocol: elb.Protocol.HTTP,
    //     unhealthyThresholdCount: 3,
    //     timeout: cdk.Duration.seconds(10),
    //   }
    // });

    // //14. Add fargate service to the PROD (blue) target group 
    // prodListener.addTargetGroups('BlueListenerTarget', blueTargetGroup);
    // testListener.addTargetGroups('BlueListenerTarget', greenTargetGroup);

    // here's the important part
    // create CodeDeploy application and deployment group
    // TODO deploymentApprovalWaitTime
    // const codeDeployAppName = `${this.stackName}-appBlueGreen`;
    // const codeDeployApp = new codeDeploy.EcsApplication(this, 'CodeDeployApp', {
    //   applicationName: codeDeployAppName
    // });
    // const deploymentGroup = new codeDeploy.EcsDeploymentGroup(this, 'CodeDeploymentGroup', {
    //   application: codeDeployApp,
    //   service: fargateService,
    //   deploymentGroupName: 'BlueGreen',
    //   blueGreenDeploymentConfig: {
    //     blueTargetGroup: blueTargetGroup,
    //     greenTargetGroup: greenTargetGroup,
    //     listener: prodListener,
    //     testListener: testListener,
    //   }
    // });

    // export cluster ARN as output
    new cdk.CfnOutput(this, 'FargateClusterArn', {
      value: cluster.clusterArn
    });
    new cdk.CfnOutput(this, 'FargateServiceArn', {
      value: this.fargateService.serviceArn
    });

    // // https://docs.aws.amazon.com/codedeploy/latest/userguide/security_iam_service-with-iam.html#arn-formats
    // this.codeDeployAppArn = `arn:aws:codedeploy:${props.env?.region}:${props.env?.account}:application:${codeDeployAppName}`;
    // console.log(this.codeDeployAppArn);
  }
}
