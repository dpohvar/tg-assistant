FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache nodejs npm python3 openssh git ripgrep tzdata ca-certificates bash \
    && adduser -D -s /bin/bash probe \
    && passwd -u probe \
    && mkdir -p /home/probe/.ssh /run/sshd \
    && ssh-keygen -A
COPY vendor /opt/codex
COPY authorized_keys /home/probe/.ssh/authorized_keys
RUN chown -R probe:probe /home/probe \
    && chmod 700 /home/probe/.ssh \
    && chmod 600 /home/probe/.ssh/authorized_keys \
    && chmod +x /opt/codex/bin/codex \
    && ln -s /opt/codex/bin/codex /usr/local/bin/codex \
    && printf '\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nAllowUsers probe\n' >> /etc/ssh/sshd_config
ENV CODEX_HOME=/home/probe/runtime/control-home
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
