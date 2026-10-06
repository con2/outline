# The image is upstream's own Dockerfile.base and Dockerfile built unmodified, with
# Dockerfile.con2 layered on top (an entrypoint that derives DATABASE_URL from POSTGRES_*).
# Named contexts chain the three stages the way skaffold's `requires` used to.
#
#   docker buildx bake                          # local build, tag ghcr.io/con2/outline:dev
#   docker buildx bake --set '*.platform=linux/amd64' --push

variable "TAG" {
  default = "dev"
}

group "default" {
  targets = ["con2"]
}

target "base" {
  dockerfile = "Dockerfile.base"
  cache-from = ["type=gha,scope=base"]
  cache-to   = ["type=gha,scope=base,mode=max"]
}

target "upstream" {
  dockerfile = "Dockerfile"
  contexts   = { outline-base = "target:base" }
  args       = { BASE_IMAGE = "outline-base" }
  cache-from = ["type=gha,scope=upstream"]
  cache-to   = ["type=gha,scope=upstream,mode=max"]
}

target "con2" {
  dockerfile = "Dockerfile.con2"
  contexts   = { outline-upstream = "target:upstream" }
  args       = { UPSTREAM_IMAGE = "outline-upstream" }
  tags       = ["ghcr.io/con2/outline:${TAG}"]
}
