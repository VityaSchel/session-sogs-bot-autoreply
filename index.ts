import { Session, ready } from '@session.js/client'
await ready
import { default as sodium } from 'libsodium-wrappers-sumo'
await sodium.ready
import { BunNetwork } from '@session.js/bun-network'
import { SignalService } from '@session.js/types/signal-bindings'
import { decryptSogsMessageData } from '@session.js/sogs'
import fs from 'fs/promises'
import path from 'path'

const configPath = path.join(__dirname, 'config.json')

let sogsUrl = ''
let sogsPublicKey = ''
let roomToken = ''
let botMnemonic = ''
let botDisplayName = ''
let useBlinding = true
let responses: { triggers: string[], response: string }[]
let lastSeqNo: number | undefined = undefined

try {
  const config = JSON.parse(await fs.readFile(configPath, 'utf-8'))
  sogsUrl = config.sogsUrl
  sogsPublicKey = config.sogsPublicKey
  roomToken = config.roomToken
  botMnemonic = config.mnemonic
  botDisplayName = config.botDisplayName
  useBlinding = config.blinding
  responses = config.responses
  lastSeqNo = config.lastSeqNo
} catch (e) {
  console.error('Failed to read config.json file', e)
}

const session = new Session({ network: new BunNetwork() })
session.setMnemonic(botMnemonic)
session.setDisplayName(botDisplayName)
const sessionId = session.getSessionID()
const blindedSessionId = session.blindSessionId(sogsPublicKey)
if (!session.getKeypair()) {
  throw new Error('Failed to get keypair')
}
const keypair = session.getKeypair()!
console.log('Running bot under', sessionId, 'blinded ID:', blindedSessionId)

function normalizeTriggers() {
  responses.forEach(res => {
    res.triggers = res.triggers.map(trig => trig.toLowerCase())
  })
}
normalizeTriggers()

async function pollMessages(sinceSeqNo: number) {
  const roomReq = await fetch(sogsUrl + '/room/' + roomToken)
  if (!roomReq.ok) {
    throw new Error('Failed to get room info')
  }
  const roomRes = await roomReq.json() as { message_sequence: number }

  for (let since = sinceSeqNo; since < roomRes.message_sequence; since += 256) {
    const messagesReq = await fetch(sogsUrl + '/room/' + roomToken + '/messages/since/' + since + '?limit=256')
    if (!messagesReq.ok) {
      throw new Error('Failed to poll messages')
    }
    const messagesRes = await messagesReq.json() as { id: number, seqno: number, data: string, session_id: string }[]
    for (const msg of messagesRes) {
      let content: SignalService.Content
      try {
        content = decryptSogsMessageData(msg.data)
      } catch (e) {
        console.warn('Couldn\'t decrypt message', msg.id, 'by', msg.session_id, e)
        continue
      }
      if (content.dataMessage && typeof content.dataMessage.body === 'string') {
        const msgText = content.dataMessage.body.toLowerCase()
        for(const res of responses) {
          if (res.triggers.includes(msgText)) {
            await replyToMessage({
              to: content,
              reply: res.response,
            })
          }
        }
      }
    }
  }

  return roomRes.message_sequence
}

async function replyToMessage({ to, reply }: {
  to: SignalService.Content,
  reply: string
}) {
  const { data, signature } = session.encodeSogsMessage({
    serverPk: sogsPublicKey,
    text: reply,
    blind: useBlinding
  })

  const body = JSON.stringify({
    data,
    signature,
  })

  await session.sendSogsRequest({
    serverPk: sogsPublicKey,
    blind: useBlinding,
    host: sogsUrl,
    endpoint: '/room/' + roomToken + '/message',
    method: 'POST',
    body,
  })
}

if (lastSeqNo === undefined) {
  const res = await session.sendSogsRequest({
    serverPk: sogsPublicKey,
    blind: useBlinding,
    host: sogsUrl,
    endpoint: '/room/' + roomToken,
    method: 'GET',
  })
  if (typeof res === 'object' && res !== null && 'message_sequence' in res && typeof res.message_sequence === 'number') {
    lastSeqNo = res.message_sequence
  } else {
    throw new Error('Failed to get room info')
  }
}

while(true) {
  lastSeqNo = await pollMessages(lastSeqNo)
  await new Promise(resolve => setTimeout(resolve, 3500))
  let config = JSON.parse(await fs.readFile(configPath, 'utf-8'))
  config.lastSeqNo = lastSeqNo
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
}