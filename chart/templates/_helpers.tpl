{{- define "outline.labels" -}}
app.kubernetes.io/part-of: outline
{{- end -}}

{{/*
The Deployment was adopted from the pre-Helm manifests and its selector is immutable, so these
three labels must stay exactly as they were.
*/}}
{{- define "outline.selectorLabels" -}}
app.kubernetes.io/part-of: outline
app.kubernetes.io/component: server
app.kubernetes.io/name: outline
{{- end -}}

{{- define "outline.tlsSecretName" -}}
tls-outline
{{- end -}}

{{/*
Shared by the migration init container and the server. Listed inline rather than in a ConfigMap:
the adopted Deployment had them inline, and server-side apply never removes list items another
field manager owns, so stale inline entries would shadow a ConfigMap forever.
*/}}
{{- define "outline.env" -}}
{{- $secret := .Values.secretName -}}
{{- $postgres := .Values.postgresSecretName -}}
- name: NODE_ENV
  value: production
- name: PORT
  value: "3000"
- name: WEB_CONCURRENCY
  value: {{ .Values.webConcurrency | quote }}
- name: URL
  value: {{ printf "https://%s" .Values.hostname | quote }}
- name: FORCE_HTTPS
  value: "false"
- name: ENABLE_UPDATES
  value: "false"
- name: SECRET_KEY
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: secretKey } }
- name: UTILS_SECRET
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: utilsSecretKey } }
- name: POSTGRES_HOSTNAME
  valueFrom: { secretKeyRef: { name: {{ $postgres }}, key: hostname } }
- name: POSTGRES_DATABASE
  valueFrom: { secretKeyRef: { name: {{ $postgres }}, key: database } }
- name: POSTGRES_USERNAME
  valueFrom: { secretKeyRef: { name: {{ $postgres }}, key: username } }
- name: POSTGRES_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ $postgres }}, key: password } }
- name: POSTGRES_PORT
  value: "5432"
- name: PGSSLMODE
  value: {{ .Values.postgres.sslMode | quote }}
- name: REDIS_URL
  value: {{ printf "redis://%s/%d" .Values.redis.hostname (int .Values.redis.database) | quote }}
- name: AWS_ACCESS_KEY_ID
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: awsAccessKeyId } }
- name: AWS_SECRET_ACCESS_KEY
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: awsSecretAccessKey } }
- name: AWS_REGION
  value: {{ .Values.s3.region | quote }}
- name: AWS_S3_UPLOAD_BUCKET_URL
  value: {{ .Values.s3.endpoint | quote }}
- name: AWS_S3_UPLOAD_BUCKET_NAME
  value: {{ .Values.s3.bucket | quote }}
- name: AWS_S3_ACL
  value: {{ .Values.s3.acl | quote }}
- name: FILE_STORAGE_UPLOAD_MAX_SIZE
  value: {{ .Values.s3.uploadMaxSize | quote }}
- name: KOMPASSI_BASE_URL
  value: {{ .Values.kompassi.baseUrl | quote }}
- name: KOMPASSI_CLIENT_ID
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: kompassiClientId } }
- name: KOMPASSI_CLIENT_SECRET
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: kompassiClientSecret } }
- name: KOMPASSI_TEAM_NAME
  value: {{ .Values.kompassi.teamName | quote }}
- name: KOMPASSI_ACCESS_GROUPS
  value: {{ join " " .Values.kompassi.accessGroups | quote }}
- name: KOMPASSI_ADMIN_GROUPS
  value: {{ join " " .Values.kompassi.adminGroups | quote }}
- name: SMTP_HOST
  value: {{ .Values.smtp.hostname | quote }}
- name: SMTP_PORT
  value: {{ .Values.smtp.port | quote }}
- name: SMTP_FROM_EMAIL
  value: {{ .Values.smtp.fromEmail | quote }}
- name: SMTP_SECURE
  value: {{ .Values.smtp.secure | quote }}
{{- if .Values.smtp.authenticated }}
- name: SMTP_USERNAME
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: smtpUsername } }
- name: SMTP_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: smtpPassword } }
{{- end }}
{{- end -}}

{{- define "outline.probe" -}}
httpGet:
  path: /_health
  port: 3000
  httpHeaders:
    - name: Host
      value: {{ .Values.hostname | quote }}
{{- end -}}

{{- define "outline.containerSecurityContext" -}}
readOnlyRootFilesystem: true
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
{{- end -}}

{{/* Writable paths the image needs on a read-only root filesystem. */}}
{{- define "outline.volumeMounts" -}}
- mountPath: /tmp
  name: outline-temp
- mountPath: /home/nodejs
  name: outline-home
{{- end -}}
