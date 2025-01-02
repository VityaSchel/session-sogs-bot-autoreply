# session-sogs-bot-autoreply

This bot automatically responds to messages in SOGS. It works using SOGS REST API.

## Installation

1. Clone this repository to your server (not necessarily the one you're hosting SOGS on): `git clone https://github.com/VityaSchel/session-sogs-bot-autoreply.git` (install `git` if it's not installed on your OS)
2. Go to cloned directory
3. Install Bun using command on [bun.sh](https://bun.sh/)
4. Install dependencies using `bun install` command
5. Generate random mnemonic: `bun generate-mnemonic.ts` (skip this step if you already have one)
6. Copy config: `cp config.example.json config.json`
7. Edit config: `nano config.json`
8. Start bot: `bun index.ts`

## Config

### `sogsUrl`

Protocol + host to access sogs. Can be localhost and external.

Examples:
- `http://localhost:3000`
- `https://sogs.hloth.dev`

### `sogsPublicKey`

64 hex characters you can find in SOGS url after ?public_key=

### `roomToken`

Token of room. Think of this as an ID. You can find room's token in URL to sogs. For example:

https://sogs.hloth.dev/bunsogs?public_key=8948f2d9046a40e7dbc0a4fd7c29d8a4fe97df1fa69e64f0ab6fc317afb9c945

There `bunsogs` is room token

### `mnemonic`

Paste generated mnemonic from step 5 or some other mnemonic

### `botDisplayName`

Displayed name of your bot, max. 64 characters

### `blinding`

Enable (recommended) if you want your bot to have 15 prefix instead of 05. Session will eventually stop supporting unblinded SOGS, so I recommend settings this to `true`

### `responses`

Array of triggers and responses.

Example:
```json
"responses": [
  {
    "triggers": ["!test", "!foobar"],
    "response": "Test response"
  },
  {
    "triggers": ["!author"],
    "response": "hloth.dev"
  }
]
```

### `lastSeqNo` (optional)

Do not add or edit this to config if you're unsure how it works. This is sequence number (i.e. last message id that bot was on)

First time you run the bot, it will automatically pick up latest message and its id add to config for future reference.

## License

[MIT](./LICENSE.md)

## Donate

[hloth.dev/donate](https://hloth.dev/donate)