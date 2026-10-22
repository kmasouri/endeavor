output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs used by the ALB and NAT gateways."
  value       = [for subnet in aws_subnet.public : subnet.id]
}

output "private_app_subnet_ids" {
  description = "Private application subnet IDs used by ECS tasks."
  value       = [for subnet in aws_subnet.private_app : subnet.id]
}

output "private_data_subnet_ids" {
  description = "Private data subnet IDs reserved for future stateful services."
  value       = [for subnet in aws_subnet.private_data : subnet.id]
}

output "load_balancer_dns_name" {
  description = "DNS name for the public ALB."
  value       = aws_lb.main.dns_name
}

output "service_ecr_repository_url" {
  description = "ECR repository URL for the service image."
  value       = aws_ecr_repository.service.repository_url
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Name of the ECS service."
  value       = aws_ecs_service.service.name
}

output "github_actions_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions deployments through OIDC."
  value       = aws_iam_role.github_actions_deploy.arn
}
