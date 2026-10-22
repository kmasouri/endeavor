# Infrastructure

Terraform for a disposable AWS test environment around the service.

## What it creates

- One VPC across two availability zones.
- Three subnet tiers:
  - public subnets for the ALB and NAT gateways
  - private application subnets for ECS Fargate tasks
  - private data subnets reserved for later stateful services
- One public Application Load Balancer that health-checks `GET /health`.
- One ECS Fargate cluster and service.
- One task role with no permissions yet. Attach policies in `ecs.tf` when the service needs AWS APIs.
- One ECR repository for the service image.
- One GitHub Actions OIDC provider and deployment role, scoped to this repository's `sandbox` environment.

## Usage

```bash
cd infrastructure
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Before `terraform apply`, set `service_container_image` in `terraform.tfvars` to an image URI that already exists. The ECR repository URL is exported after apply, so the usual first run is:

1. Create the infrastructure with a temporary image URI you already have access to, or create the ECR repository first with `terraform apply -target=aws_ecr_repository.service`.
2. Build and push the service image.
3. Update `service_container_image` to the pushed image URI, using the `:latest` tag.
4. Re-run `terraform apply`.

Database settings are passed as plain ECS task environment variables through `service_environment_variables`. Move secrets to a proper secret store (Secrets Manager or SSM Parameter Store) before treating this as anything beyond a test stack.

The GitHub release workflow expects the ECS task definition to use the ECR `:latest` tag. Each published GitHub release is pushed with both its version tag and `latest`, then ECS is forced to start new tasks.

After apply, copy these outputs into the GitHub `sandbox` environment:

| Output                           | GitHub setting                        |
| -------------------------------- | ------------------------------------- |
| `github_actions_deploy_role_arn` | secret `AWS_ROLE_TO_ASSUME`           |
| `service_ecr_repository_url`     | variable `ECR_REPOSITORY` (name only) |
| `ecs_cluster_name`               | variable `ECS_CLUSTER`                |
| `ecs_service_name`               | variable `ECS_SERVICE`                |

## Database

This stack does not create RDS. Point the service at an existing Postgres by setting `DATABASE_URL` or the discrete `DATABASE_*` variables in `service_environment_variables`. The ECS tasks must be able to reach that database over the network.

## Cost

This is a real AWS stack. The ALB and one NAT gateway per availability zone cost money while they exist, so destroy the stack when you are done testing:

```bash
terraform destroy
```
