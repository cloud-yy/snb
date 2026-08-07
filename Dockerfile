FROM node:22-alpine

WORKDIR /usr/src/app
COPY package.json yarn.lock ./

RUN yarn --pure-lockfile
RUN yarn install

COPY . .
EXPOSE 80

CMD ["yarn", "run", "start"]