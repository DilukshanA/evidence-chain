// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  EvidenceChain - Tamper-proof chain of custody for digital evidence
/// @notice Digital evidence files (CCTV clips, phone images, disk images) stay off-chain.
///         Only their SHA-256 fingerprints and every custody handover are stored on-chain,
///         so anyone (e.g. a court) can later prove a file was not changed and see who held it.
contract EvidenceChain {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------
    enum Role { None, Investigator, Custodian, ForensicLab, Court }

    enum Status { Collected, TransferPending, InCustody, Analysed, SubmittedToCourt, Sealed }

    struct Participant {
        string name;          // e.g. "IP Silva - Galle Police"
        Role role;
        bool active;
    }

    struct Case {
        string caseNumber;    // e.g. "GAL/CR/2026/0142"
        string title;
        address createdBy;
        uint256 createdAt;
        bool exists;
        uint256[] evidenceIds;
    }

    struct Evidence {
        uint256 id;
        string caseNumber;
        bytes32 fileHash;     // SHA-256 of the original file
        string description;
        string fileName;
        address collectedBy;
        address currentHolder;
        address pendingHolder; // set while a transfer is waiting to be accepted
        Status status;
        uint256 createdAt;
        bytes32 reportHash;   // SHA-256 of the forensic analysis report (0 if none)
    }

    struct CustodyEvent {
        address from;
        address to;
        string action;        // COLLECTED, TRANSFER_REQUESTED, TRANSFER_ACCEPTED, ...
        string notes;
        uint256 timestamp;
    }

    address public admin;

    mapping(address => Participant) public participants;
    address[] public participantList;

    mapping(bytes32 => Case) private cases;     // keccak256(caseNumber) => Case
    string[] public caseNumbers;

    uint256 public evidenceCount;
    mapping(uint256 => Evidence) private evidences;
    mapping(uint256 => CustodyEvent[]) private custodyLogs;
    mapping(bytes32 => uint256) public evidenceIdByHash; // fileHash => evidence id (0 = none)

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event ParticipantRegistered(address indexed account, string name, Role role);
    event ParticipantDeactivated(address indexed account);
    event CaseCreated(string caseNumber, address indexed by);
    event EvidenceRegistered(uint256 indexed id, string caseNumber, bytes32 fileHash, address indexed by);
    event TransferRequested(uint256 indexed id, address indexed from, address indexed to);
    event TransferAccepted(uint256 indexed id, address indexed newHolder);
    event TransferRejected(uint256 indexed id, address indexed by);
    event AnalysisRecorded(uint256 indexed id, bytes32 reportHash, address indexed lab);
    event SubmittedToCourt(uint256 indexed id, address indexed court);
    event EvidenceSealed(uint256 indexed id, address indexed court);
    event VerificationFailed(uint256 indexed id, bytes32 providedHash, address indexed by);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyRole(Role r) {
        require(participants[msg.sender].active && participants[msg.sender].role == r, "Not authorised for this role");
        _;
    }

    modifier onlyActive() {
        require(participants[msg.sender].active, "Not a registered participant");
        _;
    }

    modifier evidenceExists(uint256 id) {
        require(id > 0 && id <= evidenceCount, "Evidence not found");
        _;
    }

    modifier onlyHolder(uint256 id) {
        require(evidences[id].currentHolder == msg.sender, "Only current holder");
        _;
    }

    modifier notSealed(uint256 id) {
        require(evidences[id].status != Status.Sealed, "Evidence is sealed");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Participant management (admin = system administrator / court registrar)
    // ---------------------------------------------------------------------
    function registerParticipant(address account, string calldata name, Role role) external onlyAdmin {
        require(account != address(0), "Invalid address");
        require(role != Role.None, "Invalid role");
        require(bytes(name).length > 0, "Name required");
        if (participants[account].role == Role.None) {
            participantList.push(account);
        }
        participants[account] = Participant(name, role, true);
        emit ParticipantRegistered(account, name, role);
    }

    function deactivateParticipant(address account) external onlyAdmin {
        require(participants[account].active, "Not active");
        participants[account].active = false;
        emit ParticipantDeactivated(account);
    }

    function getParticipants() external view returns (address[] memory) {
        return participantList;
    }

    // ---------------------------------------------------------------------
    // Cases
    // ---------------------------------------------------------------------
    function createCase(string calldata caseNumber, string calldata title) external onlyRole(Role.Investigator) {
        bytes32 key = keccak256(bytes(caseNumber));
        require(bytes(caseNumber).length > 0, "Case number required");
        require(!cases[key].exists, "Case already exists");
        Case storage c = cases[key];
        c.caseNumber = caseNumber;
        c.title = title;
        c.createdBy = msg.sender;
        c.createdAt = block.timestamp;
        c.exists = true;
        caseNumbers.push(caseNumber);
        emit CaseCreated(caseNumber, msg.sender);
    }

    function getCase(string calldata caseNumber)
        external
        view
        returns (string memory title, address createdBy, uint256 createdAt, uint256[] memory evidenceIds)
    {
        Case storage c = cases[keccak256(bytes(caseNumber))];
        require(c.exists, "Case not found");
        return (c.title, c.createdBy, c.createdAt, c.evidenceIds);
    }

    function getCaseCount() external view returns (uint256) {
        return caseNumbers.length;
    }

    // ---------------------------------------------------------------------
    // Evidence registration
    // ---------------------------------------------------------------------
    function registerEvidence(
        string calldata caseNumber,
        bytes32 fileHash,
        string calldata fileName,
        string calldata description
    ) external onlyRole(Role.Investigator) returns (uint256) {
        Case storage c = cases[keccak256(bytes(caseNumber))];
        require(c.exists, "Case not found");
        require(fileHash != bytes32(0), "Invalid hash");
        require(evidenceIdByHash[fileHash] == 0, "This file is already registered");

        evidenceCount++;
        uint256 id = evidenceCount;
        evidences[id] = Evidence({
            id: id,
            caseNumber: caseNumber,
            fileHash: fileHash,
            description: description,
            fileName: fileName,
            collectedBy: msg.sender,
            currentHolder: msg.sender,
            pendingHolder: address(0),
            status: Status.Collected,
            createdAt: block.timestamp,
            reportHash: bytes32(0)
        });
        evidenceIdByHash[fileHash] = id;
        c.evidenceIds.push(id);

        _log(id, address(0), msg.sender, "COLLECTED", description);
        emit EvidenceRegistered(id, caseNumber, fileHash, msg.sender);
        return id;
    }

    // ---------------------------------------------------------------------
    // Two-step custody transfer: holder requests, receiver must accept
    // ---------------------------------------------------------------------
    function requestTransfer(uint256 id, address to, string calldata notes)
        external
        evidenceExists(id)
        onlyHolder(id)
        notSealed(id)
    {
        Evidence storage e = evidences[id];
        require(e.pendingHolder == address(0), "Transfer already pending");
        require(to != msg.sender, "Cannot transfer to yourself");
        require(participants[to].active, "Receiver is not a registered participant");
        require(participants[to].role != Role.Court, "Use submitToCourt for courts");

        e.pendingHolder = to;
        e.status = Status.TransferPending;
        _log(id, msg.sender, to, "TRANSFER_REQUESTED", notes);
        emit TransferRequested(id, msg.sender, to);
    }

    function acceptTransfer(uint256 id, string calldata notes) external evidenceExists(id) onlyActive notSealed(id) {
        Evidence storage e = evidences[id];
        require(e.pendingHolder == msg.sender, "No transfer pending for you");
        address from = e.currentHolder;
        e.currentHolder = msg.sender;
        e.pendingHolder = address(0);
        e.status = Status.InCustody;
        _log(id, from, msg.sender, "TRANSFER_ACCEPTED", notes);
        emit TransferAccepted(id, msg.sender);
    }

    function rejectTransfer(uint256 id, string calldata reason) external evidenceExists(id) {
        Evidence storage e = evidences[id];
        require(e.pendingHolder == msg.sender || e.currentHolder == msg.sender, "Not involved in this transfer");
        require(e.pendingHolder != address(0), "No transfer pending");
        address to = e.pendingHolder;
        e.pendingHolder = address(0);
        e.status = Status.InCustody;
        _log(id, e.currentHolder, to, "TRANSFER_CANCELLED", reason);
        emit TransferRejected(id, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Forensic analysis
    // ---------------------------------------------------------------------
    /// @param currentFileHash the lab re-hashes the file it received; it must match the original
    function recordAnalysis(uint256 id, bytes32 currentFileHash, bytes32 reportHash, string calldata findings)
        external
        evidenceExists(id)
        onlyRole(Role.ForensicLab)
        onlyHolder(id)
        notSealed(id)
    {
        Evidence storage e = evidences[id];
        require(e.pendingHolder == address(0), "Transfer pending");
        require(currentFileHash == e.fileHash, "File hash mismatch - evidence may be tampered");
        require(reportHash != bytes32(0), "Invalid report hash");
        e.reportHash = reportHash;
        e.status = Status.Analysed;
        _log(id, msg.sender, msg.sender, "ANALYSED", findings);
        emit AnalysisRecorded(id, reportHash, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Court
    // ---------------------------------------------------------------------
    function submitToCourt(uint256 id, address court, string calldata notes)
        external
        evidenceExists(id)
        onlyHolder(id)
        notSealed(id)
    {
        Evidence storage e = evidences[id];
        require(e.pendingHolder == address(0), "Transfer pending");
        require(participants[court].active && participants[court].role == Role.Court, "Receiver is not a court");
        address from = e.currentHolder;
        e.currentHolder = court;
        e.status = Status.SubmittedToCourt;
        _log(id, from, court, "SUBMITTED_TO_COURT", notes);
        emit SubmittedToCourt(id, court);
    }

    /// @notice Court closes the record. After sealing nothing can change.
    function sealEvidence(uint256 id, string calldata verdictNote)
        external
        evidenceExists(id)
        onlyRole(Role.Court)
        onlyHolder(id)
        notSealed(id)
    {
        evidences[id].status = Status.Sealed;
        _log(id, msg.sender, msg.sender, "SEALED", verdictNote);
        emit EvidenceSealed(id, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Verification (free to call - no gas for read-only)
    // ---------------------------------------------------------------------
    function verifyEvidence(uint256 id, bytes32 fileHash) external view evidenceExists(id) returns (bool) {
        return evidences[id].fileHash == fileHash;
    }

    /// @notice Records a failed integrity check permanently on-chain (tamper alert).
    function reportTamper(uint256 id, bytes32 providedHash) external evidenceExists(id) onlyActive {
        require(evidences[id].fileHash != providedHash, "Hash matches - file is authentic");
        _log(id, msg.sender, msg.sender, "TAMPER_ALERT", "Presented file does not match registered hash");
        emit VerificationFailed(id, providedHash, msg.sender);
    }

    function getEvidence(uint256 id) external view evidenceExists(id) returns (Evidence memory) {
        return evidences[id];
    }

    function getCustodyLog(uint256 id) external view evidenceExists(id) returns (CustodyEvent[] memory) {
        return custodyLogs[id];
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------
    function _log(uint256 id, address from, address to, string memory action, string memory notes) internal {
        custodyLogs[id].push(CustodyEvent(from, to, action, notes, block.timestamp));
    }
}
