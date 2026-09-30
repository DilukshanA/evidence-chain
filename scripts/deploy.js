// Deploys EvidenceChain, registers demo participants and writes frontend/config.js
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const Role = { Investigator: 1, Custodian: 2, ForensicLab: 3, Court: 4 };

async function main() {
  const [admin, police, custodian, lab, court] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("EvidenceChain");
  const chain = await Factory.deploy();
  await chain.waitForDeployment();
  const address = await chain.getAddress();
  console.log("EvidenceChain deployed to:", address);

  // Demo participants (Hardhat test accounts #1 - #4)
  const people = [
    [police, "IP Silva - Galle Police (Investigator)", Role.Investigator],
    [custodian, "Evidence Room - Galle Police (Custodian)", Role.Custodian],
    [lab, "Govt Analyst Dept - Digital Forensics Lab", Role.ForensicLab],
    [court, "Galle High Court", Role.Court],
  ];
  for (const [signer, name, role] of people) {
    await (await chain.registerParticipant(signer.address, name, role)).wait();
    console.log(`  registered ${name} -> ${signer.address}`);
  }

  // A demo case so the dashboard is not empty
  await (await chain.connect(police).createCase("GAL/CR/2026/0142", "Bank robbery - Galle Fort branch")).wait();
  console.log("  created demo case GAL/CR/2026/0142");

  const artifact = await require("hardhat").artifacts.readArtifact("EvidenceChain");
  const accounts = [
    { label: "Admin / Court Registrar", address: admin.address },
    { label: "IP Silva (Investigator)", address: police.address },
    { label: "Evidence Room (Custodian)", address: custodian.address },
    { label: "Forensic Lab", address: lab.address },
    { label: "Galle High Court", address: court.address },
  ];
  const config = {
    address,
    chainId: Number(network.config.chainId || 31337),
    rpcUrl: "http://127.0.0.1:8545",
    accounts,
    abi: artifact.abi,
  };
  const out = path.join(__dirname, "..", "frontend", "config.js");
  fs.writeFileSync(out, "window.EVIDENCE_CONFIG = " + JSON.stringify(config, null, 2) + ";\n");
  console.log("Front-end config written to frontend/config.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
