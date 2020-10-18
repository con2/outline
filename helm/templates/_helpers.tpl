{{/*
Expand the name of the chart.
*/}}
{{- define "outline.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "outline.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "outline.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "outline.labels" -}}
helm.sh/chart: {{ include "outline.chart" . }}
{{ include "outline.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "outline.selectorLabels" -}}
app.kubernetes.io/name: {{ include "outline.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Redis common labels
*/}}
{{- define "outline.redis.labels" -}}
helm.sh/chart: {{ include "outline.chart" . }}
{{ include "outline.redis.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Redis selector labels
*/}}
{{- define "outline.redis.selectorLabels" -}}
app.kubernetes.io/name: {{ include "outline.name" . }}-redis
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
PostgreSQL common labels
*/}}
{{- define "outline.postgres.labels" -}}
helm.sh/chart: {{ include "outline.chart" . }}
{{ include "outline.postgres.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
PostgreSQL selector labels
*/}}
{{- define "outline.postgres.selectorLabels" -}}
app.kubernetes.io/name: {{ include "outline.name" . }}-postgres
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "outline.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "outline.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Redis URL
*/}}
{{- define "outline.redis.url" -}}
{{- if .Values.redis.url -}}
{{ .Values.redis.url }}
{{- else -}}
redis://{{ include "outline.fullname" . }}-redis:{{ .Values.redis.service.port }}/0
{{- end }}
{{- end }}

{{- define "outline.env" -}}
- name: NODE_ENV
  value: production
- name: PORT
  value: "3000"
- name: SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}
      key: secretKey
- name: UTILS_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}
      key: utilsSecretKey
- name: URL
  value: {{ .Values.outline.url }}
- name: REDIS_URL
  value: {{ include "outline.redis.url" . }}
- name: AWS_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}
      key: awsAccessKeyId
- name: AWS_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}
      key: awsSecretAccessKey
- name: AWS_REGION
  value: {{ .Values.aws.region }}
- name: AWS_S3_UPLOAD_BUCKET_URL
  value: {{ .Values.aws.s3.uploadBucketUrl }}
- name: AWS_S3_UPLOAD_BUCKET_NAME
  value: {{ .Values.aws.s3.uploadBucketName }}
- name: AWS_S3_UPLOAD_MAX_SIZE
  value: {{ .Values.aws.s3.uploadMaxSize | quote }}
- name: AWS_S3_ACL
  value: {{ .Values.aws.s3.acl }}
- name: KOMPASSI_BASE_URL
  value: {{ .Values.kompassi.baseUrl }}
{{- if .Values.kompassi.clientId }}
- name: KOMPASSI_CLIENT_ID
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}
      key: kompassiClientId
{{- end }}
{{- if .Values.kompassi.clientSecret }}
- name: KOMPASSI_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}
      key: kompassiClientSecret
{{- end }}
- name: POSTGRES_HOSTNAME
  value: {{ .Values.postgres.hostname }}
- name: POSTGRES_DATABASE
  value: {{ .Values.postgres.database }}
- name: POSTGRES_USERNAME
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}-postgres
      key: username
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "outline.fullname" . }}-postgres
      key: password
- name: POSTGRES_PORT
  value: {{ .Values.postgres.port | quote }}
- name: POSTGRES_SSL
  value: {{ .Values.postgres.ssl | quote }}
{{- end }}

