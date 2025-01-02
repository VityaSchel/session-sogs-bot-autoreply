import { generateSeedHex } from '@session.js/keypair'
import { encode } from '@session.js/mnemonic'
import { Session, ready } from '@session.js/client'
await ready

const mnemonic = encode(generateSeedHex())
console.log('Random mnemonic:', mnemonic)

const session = new Session()
session.setMnemonic(mnemonic)
console.log('Session ID:', session.getSessionID())
