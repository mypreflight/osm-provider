output "function_name" {
  value = aws_lambda_function.function.function_name
}

output "function_url" {
  value = trimsuffix(aws_lambda_function_url.function.function_url, "/")
}
