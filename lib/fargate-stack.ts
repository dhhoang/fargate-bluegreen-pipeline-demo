import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cwLogs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class BlueGreenFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    //1. Create VPC
    const vpc = new ec2.Vpc(this, 'SharedVpc', { maxAzs: 1 });

    //2. Creation of Execution Role for our task
    const execRole = new iam.Role(this, 'FargateContainerExecRole', {
      roleName: 'apptest-container-exec-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

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
      clusterName: 'AppTest'
    });

    //5. Create a task definition for our cluster to invoke a task
    const taskDef = new ecs.FargateTaskDefinition(this, 'FargateTaskDef', {
      family: 'centauri-svc',
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: execRole,
      taskRole: execRole,   // TODO separate this from exec role
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64
      }
    });

    //7. Create container for the task definition from ECR image
    const container = taskDef.addContainer('ServerContainer', {
      containerName: 'main',
      essential: true,
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryArn(this, 'EcrRepoImport', 'arn:aws:ecr:ap-southeast-2:694500861348:apptest'),
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
      loadBalancerName: 'apptest-nlb',
      vpc: vpc,
      internetFacing: true,
    });

    //10. Add a PROD listener (blue) on a particular port for the NLB
    const prodListener = loadBalancer.addListener('NLBProdListener', {
      port: 80,
    });
    // Add a TEST listener (green)
    const testListener = loadBalancer.addListener('NLBTestListener', {
      port: 8080,
    });

    //11. Create your own security Group using VPC 
    // TODO import
    const secGroup = new ec2.SecurityGroup(this, 'ServiceSecGroup', {
      securityGroupName: 'apptest-sg',
      vpc: vpc,
      allowAllOutbound: true
    });

    //12. Add IngressRule to access the docker image on 80
    secGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP anywhere');
    secGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'HTTP anywhere');
    secGroup.addIngressRule(secGroup, ec2.Port.allTraffic(), 'In-group traffic');

    const blueTargetGroup = new elb.NetworkTargetGroup(this, 'blueGroup', {
      vpc: props.vpc!,
      protocol: albv2.ApplicationProtocol.HTTP,
      port: 80,
      targetType: albv2.TargetType.IP,
      healthCheck: {
        path: '/',
        timeout: Duration.seconds(30),
        interval: Duration.seconds(60),
        healthyHttpCodes: '200'
      }
    });
  }
}
