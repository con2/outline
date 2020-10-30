def environmentMap = [
  "con2" = ["con2"]
]

def namespaceMap = [
  "con2" = "outline"
]

pipeline {
  agent any

  environment {
    PYTHONUNBUFFERED = "1"
  }

  stages {
    stage("Build") {
      steps
        sh "emskaffolden -- build --default-repo=harbor.con2.fi/con2 --file-output build.json"
      }
    }

    stage("Deploy") {
      steps {
        script {
          for (environmentName in environmentMap.get(env.BRANCH_NAME], [])) {
            sh "emskaffolden -E ${environmentName} -- deploy -n ${namespaceMap[environmentName]} -a build.json"
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts "build.json"
      archiveArtifacts "kubernetes/template.compiled.yaml"
    }
  }
}
