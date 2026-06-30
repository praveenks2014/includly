#!/bin/bash
# GIT_ASKPASS helper — git calls this to request a password/token.
# It receives a prompt like "Password for 'https://praveenks2014@github.com': "
# Printing the PAT here keeps it off the command line and out of process listings.
echo "${GITHUB_PAT}"
