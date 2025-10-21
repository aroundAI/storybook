#!/bin/bash
# Remove all orphaned logger expectation lines from mutations.test.ts

sed -i '' '
/^[[:space:]]*{ templateId: TEMPLATE_ID },$/,/^[[:space:]]*'\''Created prompt template'\'',$/d
/^[[:space:]]*{ error: mockError },$/,/^[[:space:]]*'\''Failed to create prompt template'\'',$/d
/^[[:space:]]*{ templateId: TEMPLATE_ID },$/,/^[[:space:]]*'\''Deleted prompt template'\'',$/d
/^[[:space:]]*{ systemPromptId: SYSTEM_PROMPT_ID },$/,/^[[:space:]]*'\''Created system prompt'\'',$/d
/^[[:space:]]*{ systemPromptId: SYSTEM_PROMPT_ID },$/,/^[[:space:]]*'\''Deleted system prompt'\'',$/d
/^[[:space:]]*{$/,/^[[:space:]]*'\''Linked system prompt to template'\'',$/d
/^[[:space:]]*{$/,/^[[:space:]]*'\''Unlinked system prompt from template'\'',$/d
/^[[:space:]]*{ variantId: VARIANT_ID },$/,/^[[:space:]]*'\''Created template variant'\'',$/d
/^[[:space:]]*{ variantId: VARIANT_ID },$/,/^[[:space:]]*'\''Deleted template variant'\'',$/d
/^[[:space:]]*{$/,/^[[:space:]]*'\''Assigned variant to account'\'',$/d
/^[[:space:]]*{$/,/^[[:space:]]*'\''Unassigned variant from account'\'',$/d
/^[[:space:]]*{ experimentId: EXPERIMENT_ID },$/,/^[[:space:]]*'\''Created optimization experiment'\'',$/d
/^[[:space:]]*{ logId: '\''log-id-123'\'', templateId: TEMPLATE_ID },$/,/^[[:space:]]*'\''Logged prompt execution'\'',$/d
/^[[:space:]]*{ error: mockError },$/,/^[[:space:]]*'\''Failed to log prompt execution'\'',$/d
' mutations.test.ts
