import { Session, ready } from '@session.js/client'
await ready
import { default as sodium } from 'libsodium-wrappers-sumo'
await sodium.ready
import { BunNetwork } from '@session.js/bun-network'
import { SignalService } from '@session.js/types/signal-bindings'
import crypto from 'crypto'
import { sign } from 'curve25519-js'

const sogsUrl = 'http://localhost:3000'
const sogsPublicKey = 'f4cd02a9e484e6c30d47b3f48c0442decd9deebd132a023ee812af95a1e8621b'
const roomToken = 'roomtest'
const botMnemonic = 'innocent archer taken nestle skater snug governing cajun gave beyond pancakes soda cajun'
const botDisplayName = 'My Bot'
const useBlinding = false

const responses = [
  {
    triggers: ['!test', '!foobar'],
    response: 'Test response'
  },
  {
    triggers: ['!author'],
    response: 'hloth.dev'
  },
]

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
        content = decryptMessageData(msg.data)
      } catch (e) {
        console.warn('Couldn\'t decrypt message', msg.id, 'by', msg.session_id, e)
        continue
      }
      if (content.dataMessage && typeof content.dataMessage.body === 'string') {
        const msgText = content.dataMessage.body.toLowerCase()
        responses.forEach(res => {
          if (res.triggers.includes(msgText)) {
            replyToMessage({
              to: content,
              reply: res.response,
            })
          }
        })
      }
    }
  }
}

// Source: https://github.com/VityaSchel/bunsogs/blob/a20dc55909138dd01719aff87e64df1eb3123191/src/crypto.ts#L86
function decryptMessageData(messageData: string): SignalService.Content {
  const makebuffer = (raw: string) => {
    const b = Uint8Array.from(atob(raw), (v) => v.charCodeAt(0))
    let realLength = b.length
    while (realLength > 0 && b[realLength - 1] == 0)
      realLength--
    if (realLength > 0 && b[realLength - 1] == 0x80)
      realLength--
    return b.subarray(0, realLength)
  }

  const data = makebuffer(messageData)
  const err = SignalService.Content.verify(data)
  if (err) {
    throw new Error('Invalid message data: ' + err)
  }
  return SignalService.Content.decode(data)
}

async function replyToMessage({ to, reply }: {
  to: SignalService.Content,
  reply: string
}) {
  let messageSignature: string
  const { data, signature: blindedSignature } = session.encodeSogsMessage({
    serverPk: sogsPublicKey,
    text: reply
  })
  if(useBlinding) {
    messageSignature = blindedSignature
  } else {
    messageSignature = Buffer.from(
      unblindedSignature(new Uint8Array(Buffer.from(data, 'base64')))
    ).toString('base64')
  }

  const nonce = new Uint8Array(16)
  crypto.getRandomValues(nonce)
  const endpoint = '/room/' + roomToken + '/message'
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify({
    data,
    signature: messageSignature,
  })
  const reqSignature = await signRequest({
    timestamp,
    endpoint,
    nonce,
    method: 'POST',
    body
  })
  const unblindedSessionId = '00' + Buffer.from(keypair.ed25519.publicKey).toString('hex')
  const res = await fetch(sogsUrl + endpoint, {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-SOGS-Pubkey': useBlinding ? blindedSessionId : unblindedSessionId,
      'X-SOGS-Timestamp': String(timestamp),
      'X-SOGS-Nonce': Buffer.from(nonce).toString('base64'),
      'X-SOGS-Signature': Buffer.from(reqSignature).toString('base64'),
    },
    method: 'POST'
  })
  console.log(res.status)
}

function genericHash(outputLength: number, data: string | Uint8Array): Uint8Array {
  const hash = crypto.createHash('blake2b512')
  hash.update(data)
  return new Uint8Array(hash.digest().slice(0, outputLength))
}

async function signRequest({ timestamp, endpoint, nonce, method, body }: {
  timestamp: number
  endpoint: string
  nonce: Uint8Array
  method: string
  body: string | Uint8Array
}) {
  const bodyHashed = genericHash(64, body)
  const pk = new Uint8Array(Buffer.from(sogsPublicKey, 'hex'))
  const toSign = concatUInt8Array(
    pk,
    nonce,
    new Uint8Array(Buffer.from(timestamp.toString(),'utf-8')),
    new Uint8Array(Buffer.from(method.toString(), 'utf-8')),
    new Uint8Array(Buffer.from(endpoint.toString(), 'utf-8')),
    bodyHashed
  )
  if (useBlinding) {
    const blindingValues = getBlindingValues(pk, {
      pubKeyBytes: keypair.ed25519.publicKey,
      privKeyBytes: keypair.ed25519.privateKey
    })
    const ka = blindingValues.secretKey
    const kA = blindingValues.publicKey
    const signature = await blindedED25519Signature(toSign, keypair.ed25519.privateKey, ka, kA)
    return signature
  } else {
    return sodium.crypto_sign_detached(toSign, keypair.ed25519.privateKey)
  }
}

async function blindedED25519Signature(
  messageParts: Uint8Array,
  ourPrivKey: Uint8Array,
  ka: Uint8Array,
  kA: Uint8Array
): Promise<Uint8Array> {
  const sEncode = ourPrivKey.slice(0, 32)
  const shaFullLength = sodium.crypto_hash_sha512(sEncode)
  const Hrh = shaFullLength.slice(32)
  const r = sodium.crypto_core_ed25519_scalar_reduce(sha512Multipart([Hrh, kA, messageParts]))
  const sigR = sodium.crypto_scalarmult_ed25519_base_noclamp(r)
  const HRAM = sodium.crypto_core_ed25519_scalar_reduce(sha512Multipart([sigR, kA, messageParts]))
  const sigS = sodium.crypto_core_ed25519_scalar_add(
    r,
    sodium.crypto_core_ed25519_scalar_mul(HRAM, ka)
  )
  const fullSig = concatUInt8Array(sigR, sigS)
  return fullSig;
}

export const concatUInt8Array = (...args: Array<Uint8Array>): Uint8Array => {
  const totalLength = args.reduce((acc, current) => acc + current.length, 0)

  const concatted = new Uint8Array(totalLength)
  let currentIndex = 0
  args.forEach(arr => {
    concatted.set(arr, currentIndex)
    currentIndex += arr.length
  })

  return concatted
}

const sha512Multipart = (parts: Array<Uint8Array>) => {
  return sodium.crypto_hash_sha512(concatUInt8Array(...parts))
}

const getBlindingValues = (
  serverPK: Uint8Array,
  signingKeys: {
    pubKeyBytes: Uint8Array
    privKeyBytes: Uint8Array
  }
): {
  a: Uint8Array
  secretKey: Uint8Array
  publicKey: Uint8Array
} => {
  const k = sodium.crypto_core_ed25519_scalar_reduce(genericHash(64, serverPK))
  let a = sodium.crypto_sign_ed25519_sk_to_curve25519(signingKeys.privKeyBytes)

  if (a.length > 32) {
    console.warn('length of signing key is too long, cutting to 32: oldlength', a.length)
    a = a.slice(0, 32)
  }

  const ka = sodium.crypto_core_ed25519_scalar_mul(k, a)
  const kA = sodium.crypto_scalarmult_ed25519_base_noclamp(ka)

  return {
    a,
    secretKey: ka,
    publicKey: kA,
  }
}

export function unblindedSignature(data: Uint8Array): Uint8Array {
  return sign(keypair.x25519.privateKey, data, null)
}

await replyToMessage({
  to: {},
  reply: 'Hello!'
})