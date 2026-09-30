const { expect } = require("chai");
const { ethers } = require("hardhat");

const Role = { None: 0, Investigator: 1, Custodian: 2, ForensicLab: 3, Court: 4 };
const Status = { Collected: 0, TransferPending: 1, InCustody: 2, Analysed: 3, SubmittedToCourt: 4, Sealed: 5 };

const sha = (text) => ethers.sha256(ethers.toUtf8Bytes(text));

describe("EvidenceChain", function () {
  let chain, admin, police, custodian, lab, court, outsider;
  const CASE = "GAL/CR/2026/0142";
  const FILE = sha("cctv_clip_bank_robbery.mp4 original bytes");
  const REPORT = sha("forensic report v1");

  beforeEach(async () => {
    [admin, police, custodian, lab, court, outsider] = await ethers.getSigners();
    chain = await (await ethers.getContractFactory("EvidenceChain")).deploy();
    await chain.registerParticipant(police.address, "IP Silva - Galle Police", Role.Investigator);
    await chain.registerParticipant(custodian.address, "Evidence Room - Galle", Role.Custodian);
    await chain.registerParticipant(lab.address, "Govt Analyst Digital Lab", Role.ForensicLab);
    await chain.registerParticipant(court.address, "Galle High Court", Role.Court);
    await chain.connect(police).createCase(CASE, "Bank robbery - Galle");
  });

  async function register() {
    await chain.connect(police).registerEvidence(CASE, FILE, "cctv.mp4", "CCTV from bank entrance");
    return 1n;
  }

  describe("Access control", () => {
    it("only admin can register participants", async () => {
      await expect(chain.connect(outsider).registerParticipant(outsider.address, "x", Role.Court))
        .to.be.revertedWith("Only admin");
    });
    it("only investigators can create cases and register evidence", async () => {
      await expect(chain.connect(lab).createCase("X/1", "t")).to.be.revertedWith("Not authorised for this role");
      await expect(chain.connect(outsider).registerEvidence(CASE, FILE, "f", "d"))
        .to.be.revertedWith("Not authorised for this role");
    });
    it("deactivated participants lose access", async () => {
      await chain.deactivateParticipant(police.address);
      await expect(chain.connect(police).createCase("X/2", "t")).to.be.revertedWith("Not authorised for this role");
    });
  });

  describe("Evidence registration", () => {
    it("stores hash, holder and first custody entry", async () => {
      await expect(chain.connect(police).registerEvidence(CASE, FILE, "cctv.mp4", "CCTV"))
        .to.emit(chain, "EvidenceRegistered").withArgs(1, CASE, FILE, police.address);
      const e = await chain.getEvidence(1);
      expect(e.fileHash).to.equal(FILE);
      expect(e.currentHolder).to.equal(police.address);
      expect(e.status).to.equal(Status.Collected);
      const log = await chain.getCustodyLog(1);
      expect(log.length).to.equal(1);
      expect(log[0].action).to.equal("COLLECTED");
      const [, , , ids] = await chain.getCase(CASE);
      expect(ids.map(Number)).to.deep.equal([1]);
    });
    it("rejects duplicate files and unknown cases", async () => {
      await register();
      await expect(chain.connect(police).registerEvidence(CASE, FILE, "a", "b"))
        .to.be.revertedWith("This file is already registered");
      await expect(chain.connect(police).registerEvidence("NOPE", sha("z"), "a", "b"))
        .to.be.revertedWith("Case not found");
    });
    it("rejects duplicate case numbers", async () => {
      await expect(chain.connect(police).createCase(CASE, "again")).to.be.revertedWith("Case already exists");
    });
  });

  describe("Chain of custody", () => {
    beforeEach(register);

    it("requires the receiver to accept (two-step transfer)", async () => {
      await chain.connect(police).requestTransfer(1, custodian.address, "Sealed bag #A12");
      let e = await chain.getEvidence(1);
      expect(e.status).to.equal(Status.TransferPending);
      expect(e.currentHolder).to.equal(police.address);

      await expect(chain.connect(lab).acceptTransfer(1, "x")).to.be.revertedWith("No transfer pending for you");
      await chain.connect(custodian).acceptTransfer(1, "Received, seal intact");
      e = await chain.getEvidence(1);
      expect(e.currentHolder).to.equal(custodian.address);
      expect(e.status).to.equal(Status.InCustody);
    });

    it("only the current holder can hand over evidence", async () => {
      await expect(chain.connect(lab).requestTransfer(1, lab.address, "steal"))
        .to.be.revertedWith("Only current holder");
    });

    it("cannot transfer to unregistered accounts", async () => {
      await expect(chain.connect(police).requestTransfer(1, outsider.address, ""))
        .to.be.revertedWith("Receiver is not a registered participant");
    });

    it("receiver can reject a transfer", async () => {
      await chain.connect(police).requestTransfer(1, custodian.address, "");
      await chain.connect(custodian).rejectTransfer(1, "Seal broken on arrival");
      const e = await chain.getEvidence(1);
      expect(e.currentHolder).to.equal(police.address);
      expect(e.pendingHolder).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Forensic analysis, court and sealing", () => {
    beforeEach(async () => {
      await register();
      await chain.connect(police).requestTransfer(1, lab.address, "For analysis");
      await chain.connect(lab).acceptTransfer(1, "Received");
    });

    it("lab analysis fails if file was modified", async () => {
      await expect(chain.connect(lab).recordAnalysis(1, sha("edited video"), REPORT, "x"))
        .to.be.revertedWith("File hash mismatch - evidence may be tampered");
    });

    it("full lifecycle ends with a sealed, verifiable record", async () => {
      await chain.connect(lab).recordAnalysis(1, FILE, REPORT, "Suspect face matched");
      await chain.connect(lab).submitToCourt(1, court.address, "Case file with report");
      await chain.connect(court).sealEvidence(1, "Judgment delivered");

      const e = await chain.getEvidence(1);
      expect(e.status).to.equal(Status.Sealed);
      expect(e.reportHash).to.equal(REPORT);
      expect(await chain.verifyEvidence(1, FILE)).to.equal(true);
      expect(await chain.verifyEvidence(1, sha("fake"))).to.equal(false);

      const actions = (await chain.getCustodyLog(1)).map((l) => l.action);
      expect(actions).to.deep.equal([
        "COLLECTED", "TRANSFER_REQUESTED", "TRANSFER_ACCEPTED", "ANALYSED", "SUBMITTED_TO_COURT", "SEALED",
      ]);

      await expect(chain.connect(court).requestTransfer(1, lab.address, "")).to.be.revertedWith("Evidence is sealed");
    });

    it("tamper alerts are logged permanently", async () => {
      await expect(chain.connect(lab).reportTamper(1, sha("edited")))
        .to.emit(chain, "VerificationFailed");
      await expect(chain.connect(lab).reportTamper(1, FILE)).to.be.revertedWith("Hash matches - file is authentic");
      const log = await chain.getCustodyLog(1);
      expect(log[log.length - 1].action).to.equal("TAMPER_ALERT");
    });

    it("only a court account can receive court submissions", async () => {
      await expect(chain.connect(lab).submitToCourt(1, custodian.address, ""))
        .to.be.revertedWith("Receiver is not a court");
    });
  });
});
