# EvidenceChain: Blockchain Based Chain of Custody for Digital Evidence

EC8204 Blockchain and Cyber Security – Group Project

## Problem

Digital evidence (CCTV clips, phone photos, call records, disk images) is very easy to copy and edit.
In court, the defence often asks two questions:

1. Is this the same file that was collected at the scene?
2. Who handled it, and when?

Today the answer depends on paper forms and a central database that insiders can change.
If a record is edited or lost, the evidence can be rejected.

## Solution

EvidenceChain keeps the evidence files **off-chain** (they stay with police / lab) and stores only:

- the **SHA-256 fingerprint** of each file, and
- every **custody handover** (who gave it, who received it, when, notes)

on an Ethereum smart contract. Nobody, including the system admin, can edit or delete these records.

| Feature | How it works |
| --- | --- |
| Role-based access | Admin registers Investigators, Custodians, Forensic Labs and Courts. Only the right role can do each action. |
| Tamper detection | Anyone can re-hash a file and compare it with the on-chain fingerprint. Even a 1-byte change gives a different hash. |
| Two-step handover | The current holder requests a transfer, the receiver must accept it. No silent handovers. |
| Lab integrity check | The forensic lab must submit the hash of the file it received. The contract rejects the analysis if it does not match. |
| Duplicate check | The same file cannot be registered twice. |
| Tamper alerts | A failed check can be recorded on-chain permanently. |
| Sealing | The court seals the record after the case. No more changes are possible. |
| Privacy | Files never leave the user's computer. Hashing is done in the browser. |

## Project structure

```
contracts/EvidenceChain.sol   Smart contract
test/EvidenceChain.test.js    14 unit tests
scripts/deploy.js             Deploys contract, registers demo users, writes frontend/config.js
scripts/serve.js              Small web server for the front-end
frontend/                     Web DApp (HTML + JavaScript + ethers.js)
sample-evidence/              Demo files (original video, edited video, lab report)
```

## Easiest way to run on Windows

Install Node.js (LTS) from https://nodejs.org, then double click `start-demo.bat`.
It installs packages (first time only), starts the blockchain, deploys the contract and opens http://localhost:3000.

## How to run manually (Windows / Mac / Linux)

Requirements: Node.js 18 or newer.

```bash
# 1. install packages (first time only)
npm install

# 2. run the unit tests
npx hardhat test

# 3. terminal 1 - start a local blockchain
npx hardhat node

# 4. terminal 2 - deploy the contract and demo users
npx hardhat run scripts/deploy.js --network localhost

# 5. terminal 2 - start the web app
node scripts/serve.js
```

Open **http://localhost:3000**.

Use the account menu at the top right to act as different people (Police, Evidence Room, Lab, Court, Admin).
These are Hardhat test accounts, so no MetaMask is needed for the demo.

To use MetaMask instead: add network `http://127.0.0.1:8545`, chain ID `31337`, import the private keys
printed by `npx hardhat node` (accounts #0–#4), then choose **MetaMask** in the top menu.

> If you restart `npx hardhat node`, run the deploy script again (the chain starts empty).

## Demo flow (for the video)

1. **IP Silva (Investigator)** → Register Evidence → pick `sample-evidence/cctv_bank_entrance.mp4` → Register.
2. Custody Actions → hand over to **Evidence Room**.
3. Switch to **Evidence Room** → Accept. Then hand over to **Forensic Lab**.
4. Switch to **Forensic Lab** → Accept. Record analysis using the **EDITED** video first → contract rejects it.
   Then use the original video + `forensic_report_GAL-0142.pdf` → accepted. Submit to court.
5. Switch to **Galle High Court** → Verify File: original = AUTHENTIC, EDITED = TAMPERED → record tamper alert.
6. Seal the evidence. Dashboard → History shows the full chain of custody.

## Tech stack

Solidity 0.8.24 · Hardhat · ethers.js v6 · HTML/CSS/JavaScript · Web Crypto API (SHA-256)
