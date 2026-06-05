# oci-g

A minimal OCI Generative AI bridge skeleton for Worker-style runtimes.

## Current status

This repository currently contains a bridge scaffold only:

- parses `Authorization: Bearer tenancy|user|fingerprint|privateKey`
- reads an OpenAI-style request body
- maps it into an OCI chat payload skeleton
- does **not** yet sign and forward the OCI request

Main file:

- `index.js`
