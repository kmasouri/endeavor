resource "aws_ecr_repository" "service" {
  name                 = "${local.name_prefix}-service"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}
