# Daily logical backup of the StealthMark Supabase database (Postgres 17) into Cloud Storage.
FROM postgres:17-alpine
RUN apk add --no-cache curl ca-certificates
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh && adduser -D -u 10001 backup
USER backup
ENTRYPOINT ["/usr/local/bin/backup.sh"]
