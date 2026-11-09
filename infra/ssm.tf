resource "aws_ssm_parameter" "url" {
  name  = "/mypreflight/${local.name}/url"
  type  = "String"
  value = trimsuffix(aws_lambda_function_url.function.function_url, "/")
}

resource "aws_ssm_parameter" "secret" {
  name  = "/mypreflight/${local.name}/secret"
  type  = "SecureString"
  value = random_password.function_secret.result
}
