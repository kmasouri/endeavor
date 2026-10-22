resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"
}

resource "aws_cloudwatch_log_group" "service" {
  name              = "/ecs/${local.name_prefix}/service"
  retention_in_days = 14
}

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Role the running service assumes. It has no permissions yet; attach policies here when the
# service needs to call AWS APIs.
resource "aws_iam_role" "service_task" {
  name               = "${local.name_prefix}-service-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_ecs_task_definition" "service" {
  family                   = "${local.name_prefix}-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.service_cpu)
  memory                   = tostring(var.service_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.service_task.arn

  container_definitions = jsonencode([
    {
      name      = "service"
      image     = var.service_container_image
      essential = true
      portMappings = [
        {
          containerPort = var.service_container_port
          hostPort      = var.service_container_port
          protocol      = "tcp"
        }
      ]
      environment = local.service_environment
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "service" {
  name            = "${local.name_prefix}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.service_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    assign_public_ip = false
    security_groups  = [aws_security_group.service.id]
    subnets          = [for subnet in aws_subnet.private_app : subnet.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.service.arn
    container_name   = "service"
    container_port   = var.service_container_port
  }

  depends_on = [aws_lb_listener.http]
}
