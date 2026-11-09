data "aws_ssm_parameter" "workload_boundary_arn" {
  name = "/mypreflight/bootstrap/workload-boundary-arn"
}
