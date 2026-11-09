terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  backend "s3" {
    bucket       = "mypreflight-infra"
    key          = "osm-provider/terraform.tfstate"
    region       = var.aws_region
    use_lockfile = true
  }

  encryption {
    key_provider "aws_kms" "state" {
      kms_key_id = "alias/mypreflight-state-key"
      region     = var.aws_region
      key_spec   = "AES_256"
    }

    method "aes_gcm" "state" {
      keys = key_provider.aws_kms.state
    }

    state {
      method   = method.aes_gcm.state
      enforced = true
    }

    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "mypreflight"
      Stack     = local.name
      ManagedBy = "opentofu"
    }
  }
}
