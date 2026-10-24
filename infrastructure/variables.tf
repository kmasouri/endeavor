variable "project_name" {
  description = "Short project name used in AWS resource names. Keep it short: ALB and target group names are limited to 32 characters."
  type        = string
  # Compatibility default: existing state must not recreate resources during a rebrand.
  # New stacks set project_name = "endeavor"; see ../docs/rebranding.md.
  default     = "bold-cedar-007"
}

variable "environment" {
  description = "Environment label used in AWS resource names and tags."
  type        = string
  default     = "sandbox"
}

variable "aws_region" {
  description = "AWS region where the environment is created."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of availability zones to use for each subnet tier."
  type        = number
  default     = 2
}

variable "service_container_image" {
  description = "Container image URI for the ECS task. Push an image to the created ECR repo and set this value before apply."
  type        = string
}

variable "service_container_port" {
  description = "Port exposed by the service container."
  type        = number
  default     = 3000
}

variable "service_desired_count" {
  description = "Number of ECS tasks to run."
  type        = number
  default     = 1
}

variable "service_cpu" {
  description = "CPU units for the Fargate task."
  type        = number
  default     = 256
}

variable "service_memory" {
  description = "Memory in MiB for the Fargate task."
  type        = number
  default     = 512
}

variable "service_environment_variables" {
  description = "Plain environment variables passed into the service container."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Additional tags applied to all supported resources."
  type        = map(string)
  default     = {}
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deployment role, in owner/repo format."
  type        = string
}

variable "github_environment" {
  description = "GitHub Actions environment allowed to assume the deployment role."
  type        = string
  default     = "sandbox"
}
