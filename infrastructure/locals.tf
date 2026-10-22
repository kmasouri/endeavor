data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)

  public_subnets = {
    for index, az in local.azs :
    az => cidrsubnet(var.vpc_cidr, 8, index)
  }

  private_app_subnets = {
    for index, az in local.azs :
    az => cidrsubnet(var.vpc_cidr, 8, index + 10)
  }

  private_data_subnets = {
    for index, az in local.azs :
    az => cidrsubnet(var.vpc_cidr, 8, index + 20)
  }

  service_environment = [
    for key, value in var.service_environment_variables : {
      name  = key
      value = value
    }
  ]
}
