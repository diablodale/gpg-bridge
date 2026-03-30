FROM mcr.microsoft.com/devcontainers/javascript-node:22-trixie

WORKDIR /opt/gpg-bridge-deps
# Root package.json/package-lock.json are copied so npm understands the workspace structure
# when resolving the "file:../shared" dependency in gpg-bridge-request. The root
# devDependencies (@vscode/test-electron, @devcontainers/cli, etc.) run on the host,
# not inside the container, so the root packages are never installed here.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package-lock.json ./shared/
COPY gpg-bridge-request/package.json gpg-bridge-request/package-lock.json ./gpg-bridge-request/

RUN cd shared && npm install && \
    cd ../gpg-bridge-request && npm install
