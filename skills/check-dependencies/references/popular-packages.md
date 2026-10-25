# Popular npm packages (near-name check)

Used by `deps.suspicious-package`. A dependency whose name is **one edit away** (one letter added, removed, swapped for another, or two neighbours swapped, counting `-`, `.` and `_` as letters) from a name below, and which is **not itself on this list**, is a near-name. Typosquatters publish such names (`loadsh`, `crossenv`, `expres`, `reqeusts`) hoping someone mistypes an install command.

Compare the bare name for unscoped packages. For scoped packages (`@scope/name`), compare the whole name; a scope that is one edit away from a known scope (`@supabse/…`, `@type/node`) is also a near-name.

## The list (about 140 names: the roughly 100 most-depended-upon and most-installed npm packages, plus the SDKs and tools common in this plugin's target stacks)

Utilities: `lodash`, `underscore`, `async`, `bluebird`, `uuid`, `nanoid`, `moment`, `dayjs`, `date-fns`, `classnames`, `clsx`, `qs`, `ms`, `debug`, `semver`, `minimist`, `yargs`, `commander`, `chalk`, `colors`, `ora`, `inquirer`, `dotenv`, `cross-env`, `cross-spawn`, `execa`, `rimraf`, `mkdirp`, `glob`, `fast-glob`, `minimatch`, `micromatch`, `chokidar`, `fs-extra`, `graceful-fs`, `js-yaml`, `yaml`, `lru-cache`, `rxjs`, `immer`, `tslib`, `core-js`, `regenerator-runtime`, `object-assign`, `safe-buffer`, `readable-stream`, `through2`, `iconv-lite`, `source-map`, `ws`, `form-data`, `mime`, `mime-types`, `cookie`, `crypto-js`, `validator`, `xml2js`, `cheerio`

HTTP and servers: `express`, `body-parser`, `cookie-parser`, `cors`, `helmet`, `morgan`, `multer`, `passport`, `jsonwebtoken`, `bcrypt`, `bcryptjs`, `axios`, `node-fetch`, `got`, `request`, `superagent`, `socket.io`, `socket.io-client`, `nodemailer`, `winston`, `pino`

Frameworks and UI: `react`, `react-dom`, `react-router`, `react-router-dom`, `next`, `vue`, `svelte`, `@sveltejs/kit`, `@remix-run/react`, `jquery`, `redux`, `react-redux`, `@reduxjs/toolkit`, `zustand`, `@tanstack/react-query`, `styled-components`, `prop-types`, `tailwindcss`, `postcss`, `autoprefixer`, `sass`, `framer-motion`, `lucide-react`

Data and validation: `zod`, `yup`, `joi`, `ajv`, `graphql`, `mongoose`, `mongodb`, `pg`, `mysql2`, `sqlite3`, `redis`, `ioredis`, `sequelize`, `knex`, `typeorm`, `prisma`, `@prisma/client`, `drizzle-orm`

Services and SDKs: `@supabase/supabase-js`, `@supabase/ssr`, `firebase`, `firebase-admin`, `stripe`, `@stripe/stripe-js`, `openai`, `@anthropic-ai/sdk`, `ai`, `@google/generative-ai`, `aws-sdk`, `@aws-sdk/client-s3`, `googleapis`, `@clerk/nextjs`, `next-auth`, `resend`

Build and test: `typescript`, `@types/node`, `@types/react`, `webpack`, `vite`, `esbuild`, `@babel/core`, `@babel/runtime`, `eslint`, `prettier`, `jest`, `mocha`, `chai`, `vitest`, `nodemon`, `ts-node`, `tsx`, `concurrently`, `husky`

## Real packages that are one edit from a listed name

These are legitimate, widely used projects, not near-names: `preact` (react), `vuex` (vue), `nuxt` (next), `cookies` (cookie), `color` (colors), `tslint` (eslint), `uid` (uuid), and short real names such as `yarn`, `pug`, `ejs`, `koa`. Names of two or three letters (`ai`, `ms`, `ws`, `pg`, `qs`, `got`, `ora`) are one edit from many real packages, so never use them as anchors for a near-name. Before calling a name a near-name, ask whether it is a well-known package in its own right; if you're not sure, it stays `unverified`.

## Packages known to have install scripts for good reasons

Native builds or binary downloads: `esbuild`, `@esbuild/*`, `sharp`, `@swc/core`, `bcrypt`, `sqlite3`, `better-sqlite3`, `canvas`, `node-gyp` users, `prisma`, `@prisma/client`, `@prisma/engines`, `puppeteer`, `playwright`, `cypress`, `electron`, `husky`, `core-js` (a funding message), `protobufjs`, `fsevents`, `nodemon`, `msw`, `@parcel/watcher`, `lefthook`, `turbo`, `@sentry/cli`, `unrs-resolver`, `bufferutil`, `utf-8-validate`.

An install script on one of these is not a finding. An install script on a package you don't recognise and that has no obvious reason to build anything (a small utility, a styling helper) is `unverified`: "worth a look".
