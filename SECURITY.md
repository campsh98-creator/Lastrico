# Security Policy

## Supported versions

Lastrico by Motia is in beta. Security fixes are applied to the latest version on the
default branch and, when applicable, the current deployed beta. Motia strategy documents do
not imply that planned platform, native, automotive, payment, or investment systems are
deployed. Older commits and third-party forks are not supported.

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials, tokens, personal data, or sensitive location
details in a public issue.

Use a
[private GitHub Security Advisory](https://github.com/campsh98-creator/Lastrico/security/advisories/new).
Describe the affected version, impact, reproduction steps, and any suggested mitigation.
Include only the minimum data required and remove personal locations and credentials.

The maintainer aims to acknowledge a report within three business days, provide a status
update within seven business days, and coordinate disclosure after a fix or mitigation is
available. These are best-effort beta targets, not guaranteed service levels.

## Scope and limitations

Relevant reports include authentication or authorisation failures, secret exposure,
injection, abuse of community reports, sensitive-data leakage, and vulnerabilities in
deployment or dependencies.

Future location history, image/voice evidence, contributor identity, payments,
crowdfunding, native navigation, partner feeds, or automotive integrations require a new
threat model and security/privacy review before release. Do not send production partner
data, investor records, identity documents, or personal route traces to this repository.

The beta relies on external mapping and routing providers. Provider outages, incomplete
road-surface data, GPS inaccuracy, and unsuitable route suggestions are important product
issues but are not automatically software security vulnerabilities. Use the appropriate
issue template unless the problem also exposes data or enables abuse.

Lastrico is not an emergency service or a safety-certified navigation system. It cannot
guarantee road safety, prevent accidents, or replace traffic laws, signs, closures, weather
information, or the traveller's judgement.
