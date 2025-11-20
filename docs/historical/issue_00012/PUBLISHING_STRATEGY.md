# Publishing Strategy: Clean to Comprehensive in 4 Phases

**Issue**: #12 - Ready project for repo publishing
**Timeline**: 2 days
**Goal**: Public GitHub repo + npm package ready for article publication
**Created**: 2025-01-19

## Executive Summary

This repository needs to transition from a development workspace to a professionally published project within 2 days. The strategy focuses on **repository organization** (what developers see) while keeping **npm package lean** (what users install).

**Key Insight**: The `package.json` `files` field already correctly limits the npm package to `dist/`, `README.md`, and `LICENSE`. Our work is about organizing the **repository** for developers, not the package for users.

---

## Current State Analysis

### ✅ Already Good
- **npm Package Scope**: Correctly limited via `files` field
- **Testing**: 1,173 tests passing (100% success rate)
- **Documentation Trail**: Historical issue tracking in `docs/historical/`
- **Design Documentation**: Comprehensive in `design/` directory
- **License**: MIT (permits modification and redistribution)

### ⚠️ Needs Attention
- **Root Directory Clutter**: 4 dev process .md files at root level
- **Directory Organization**: `design/` separate from `docs/development/`
- **Mental Mapping**: Not clear where things belong
- **README**: Mixes user docs with development process
- **Missing Files**: CONTRIBUTING.md, CHANGELOG.md

---

## Directory Philosophy

### The Mental Model

```
Repository (Git)
├── What Users See & Install (npm package)
│   ├── README.md ..................... Package overview, quick start
│   ├── LICENSE ........................ Legal
│   └── dist/ .......................... Compiled code
│
└── What Developers/Contributors See (repo only)
    ├── src/ ........................... Source code
    ├── tests/ ......................... Test suites
    ├── docs/ .......................... ALL documentation
    │   ├── user/ ...................... End-user guides (if needed)
    │   ├── development/ ............... Developer process & tools
    │   │   ├── design/ ................ Design docs, API refs (MOVE from root)
    │   │   ├── testing/ ............... Test strategies (MOVE from root)
    │   │   └── workflows/ ............. Dev workflows
    │   └── historical/ ................ Issue investigations (KEEP)
    ├── scripts/ ....................... Build & utility scripts
    └── CONTRIBUTING.md ................ How to contribute
```

### Opinion on `docs/historical/`

**KEEP IT EXACTLY WHERE IT IS** ✅

**Reasoning**:
1. **Purpose**: Documents past design decisions and problem-solving processes
2. **Audience**: Future maintainers (including you in 6 months)
3. **Value**: Prevents re-litigating solved problems
4. **Placement**: `docs/` because it's documentation, `historical/` because it's time-bound investigations
5. **Not User Docs**: Correctly excluded from npm package, correctly included in repo

**This is textbook example of good developer documentation organization.**

---

## 4-Phase Strategy

### Phase 1: Audit & Categorize (Day 1: 9am-12pm, 3 hours)

**Goal**: Know what we have and where it should go

#### Tasks

1. **File Inventory** (30 min)
   - Create spreadsheet of all .md files
   - Categorize each: User Doc | Dev Doc | Historical | Design | Process
   - Identify what's referenced in README vs what's orphaned

2. **Dependency Mapping** (30 min)
   - Check all internal links in markdown files
   - Identify cross-references between docs
   - List what README.md links to

3. **Package Verification** (1 hour)
   - Run `npm pack` locally
   - Extract and verify package contents
   - Confirm only `dist/`, `README.md`, `LICENSE` included
   - Test installation: `npm install ./package-name-0.0.3.tgz`

4. **Decision Matrix** (1 hour)
   - For each root .md file, decide: Keep | Move | Delete | Merge
   - For `design/` directory, decide final location
   - Document rationale

**Deliverable**: `AUDIT_RESULTS.md` in this directory

---

### Phase 2: Restructure & Relocate (Day 1: 1pm-5pm, 4 hours)

**Goal**: Move files to their forever homes

#### Proposed Structure Changes

```
MOVE:
  design/               → docs/development/design/
  TESTING_STRATEGY.md   → docs/development/testing/TESTING_STRATEGY.md
  SERVICE_ACCOUNT_*.md  → docs/development/SERVICE_ACCOUNT_IMPLEMENTATION.md
  TEST_DOCUMENT_*.md    → docs/development/TEST_DOCUMENT_SETUP.md

KEEP AT ROOT:
  README.md             (main entry point)
  LICENSE               (required)
  CLAUDE.md             (AI instructions - not in npm package)
  package.json          (required)
  tsconfig.json         (required)
  etc...

CREATE:
  CONTRIBUTING.md       (root level - GitHub convention)
  CHANGELOG.md          (root level - npm convention)
  docs/README.md        (update with new structure)
```

#### Tasks

1. **Create New Directories** (15 min)
   ```bash
   mkdir -p docs/development/design
   mkdir -p docs/development/testing
   ```

2. **Move Files** (1 hour)
   - Move `design/*` to `docs/development/design/`
   - Move process docs to `docs/development/`
   - Update `docs/README.md` to reflect new structure

3. **Update All Links** (2 hours)
   - Update relative paths in all moved files
   - Update README.md references
   - Update CLAUDE.md references
   - Fix all broken links

4. **Create Missing Files** (1 hour)
   - `CONTRIBUTING.md` with:
     - Development setup
     - Testing requirements
     - Pull request process
     - Reference to docs/development/
   - `CHANGELOG.md` with:
     - v0.0.3 - Bug fix: trash filtering
     - v0.0.2 - Previous release
     - Format: Keep a Changelog

**Deliverable**: Reorganized repository with working links

---

### Phase 3: Polish & Verify (Day 2: 9am-1pm, 4 hours)

**Goal**: Professional quality, ready for public eyes

#### Tasks

1. **README.md Overhaul** (1.5 hours)

   **Current Issues**:
   - Mixes user quick-start with development process
   - Breaking changes section too prominent
   - Missing badges (build status, npm version, license)

   **New Structure**:
   ```markdown
   # Google Drive Collaboration MCP

   [Badges: npm version, build status, license, MCP]

   One-paragraph value proposition.

   ## Features (bullet points)
   ## Quick Start (installation + basic usage)
   ## Documentation (links to usage examples)
   ## Requirements
   ## Installation
   ## Configuration
   ## Usage Examples (2-3 common scenarios)
   ## Available Tools (high-level categories)
   ## Contributing (link to CONTRIBUTING.md)
   ## License
   ## Acknowledgments

   ---

   For developers: See docs/development/
   For breaking changes: See CHANGELOG.md
   ```

2. **Package.json Polish** (30 min)
   - Verify all metadata accurate
   - Check keywords (max 10-12 relevant ones)
   - Verify repository URLs
   - Check homepage, bugs URLs
   - Add "publishConfig" if needed

3. **CHANGELOG.md** (30 min)
   - Document v0.0.3 changes properly
   - Include link to GitHub issue #11
   - Format consistently

4. **Test Package Locally** (1 hour)
   - `npm pack`
   - Install in separate test directory
   - Verify functionality
   - Check package size
   - Test on fresh Node.js environment

5. **Documentation Links Audit** (30 min)
   - Run link checker on all .md files
   - Fix any broken links
   - Verify GitHub URLs will work when public

**Deliverable**: Publication-ready repository

---

### Phase 4: Publish (Day 2: 2pm-5pm, 3 hours)

**Goal**: Live on npm, ready for article

#### Pre-Flight Checklist

- [ ] All tests passing (npm test)
- [ ] Build successful (npm run build)
- [ ] Package installs locally
- [ ] README.md looks good on GitHub
- [ ] No sensitive information in repo
- [ ] CHANGELOG.md updated
- [ ] Version is 0.0.3
- [ ] Git tag ready: v0.0.3

#### Tasks

1. **Final Repository Review** (30 min)
   - Quick visual scan of all directories
   - Check .gitignore is correct
   - Verify no .env or credential files
   - Check GitHub repo settings (if applicable)

2. **npm Publish** (1 hour)
   ```bash
   npm login
   npm publish --access public --dry-run  # Test first!
   npm publish --access public             # Real deal
   ```
   - Verify package appears on npmjs.com
   - Test installation: `npm install @clintagossett/google-drive-collaboration-mcp`
   - Check package page metadata

3. **Git Tag & Release** (30 min)
   ```bash
   git tag -a v0.0.3 -m "Release v0.0.3: Trash filtering bug fix"
   git push origin v0.0.3
   ```
   - Create GitHub Release
   - Copy CHANGELOG entry to release notes
   - Link to closed issues

4. **Verification** (30 min)
   - Install package in fresh directory
   - Test basic functionality
   - Verify README renders correctly on npm
   - Check GitHub repo looks professional

5. **Documentation for Article** (30 min)
   - Note npm install command
   - Screenshot package page
   - Verify all article claims are accurate
   - Test any code examples in article

**Deliverable**: Published npm package, tagged release, ready for article

---

## Risk Mitigation

### Risk: Breaking Links
- **Mitigation**: Use relative paths consistently
- **Verification**: grep for absolute GitHub URLs, replace with relative
- **Testing**: Click every link in README.md

### Risk: Sensitive Information
- **Mitigation**: Audit for credentials, API keys, private file paths
- **Verification**: Search for common patterns (.json, keys, tokens, passwords)
- **Testing**: Fresh eyes review by tool or person

### Risk: Package Size
- **Mitigation**: `files` field already limits to dist/, README, LICENSE
- **Verification**: Check `npm pack` output size
- **Target**: < 1MB is ideal

### Risk: npm Publish Failure
- **Mitigation**: `--dry-run` first, check npm credentials
- **Verification**: Test with separate npm account if possible
- **Backup**: Can always unpublish within 72 hours if needed

---

## Success Metrics

### Repository Quality
- [ ] Clear directory structure
- [ ] No root-level dev process clutter
- [ ] All links work
- [ ] Professional README
- [ ] CONTRIBUTING.md exists

### Package Quality
- [ ] Installs without errors
- [ ] < 1MB package size
- [ ] Only contains dist/, README, LICENSE
- [ ] Metadata complete and accurate

### Publication Ready
- [ ] Published on npm
- [ ] GitHub release tagged
- [ ] All tests passing
- [ ] Article claims verified
- [ ] Install instructions work

---

## Post-Publication Checklist

Within 24 hours of article publication:

- [ ] Monitor npm download stats
- [ ] Watch GitHub for issues
- [ ] Respond to any questions promptly
- [ ] Update article if needed
- [ ] Celebrate! 🎉

---

## Appendix: Key Decisions

### Why Keep docs/historical/?
Historical documentation serves future maintainers. It's the "why" behind the "what". When someone asks "Why did we do it this way?" six months from now, the answer is in `docs/historical/issue_XXXXX/`. This is gold for long-term maintenance.

### Why Move design/ to docs/development/design/?
Mental mapping: **All documentation lives under docs/**. The `design/` directory at root level breaks that pattern. Moving it to `docs/development/design/` makes it clear: this is developer-facing design documentation, not user-facing usage documentation.

### Why Create CONTRIBUTING.md at Root?
GitHub convention. Developers expect it there. It shows up automatically in PR templates. Root-level placement signals "we want contributors."

### Why Keep npm Package Minimal?
Users don't need your development process. They need working code, a README, and a license. Everything else is repository-only. The `files` field in package.json is your friend.

---

## Timeline Summary

| Phase | Time | Duration | Focus |
|-------|------|----------|-------|
| Phase 1: Audit | Day 1, 9am-12pm | 3 hrs | Know what we have |
| Phase 2: Restructure | Day 1, 1pm-5pm | 4 hrs | Move to final homes |
| Phase 3: Polish | Day 2, 9am-1pm | 4 hrs | Professional quality |
| Phase 4: Publish | Day 2, 2pm-5pm | 3 hrs | Go live |
| **Total** | **2 days** | **14 hrs** | **Public + npm ready** |

---

**Next Step**: Begin Phase 1 - Audit & Categorize. Create `AUDIT_RESULTS.md` in this directory with findings.
