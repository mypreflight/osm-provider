data "aws_ssm_parameter" "workload_boundary_arn" {
  name = "/mypreflight/bootstrap/workload-boundary-arn"
}

data "archive_file" "bundle" {
  type        = "zip"
  source_file = local.bundle_path
  output_path = "${path.module}/build/lambda.zip"
}
