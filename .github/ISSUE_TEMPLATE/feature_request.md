name: Feature request
description: Suggest something Emberwake could do
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
      description: >
        Please describe the situation rather than the feature. "Two people always
        dominate game night and nobody can prove it" is a problem; "add a
        leaderboard" is a solution that may or may not fit.
    validations:
      required: true

  - type: textarea
    id: proposal
    attributes:
      label: What you would like to happen
    validations:
      required: true

  - type: textarea
    id: fits-principle
    attributes:
      label: Does this keep the 3D scene honest?
      description: >
        Emberwake's core commitment is that the geometry is generated from the
        same data as the report. If your idea adds something the scene cannot
        honestly represent, please say so — that is a useful answer, not a
        rejection.
      render: text

  - type: checkboxes
    id: constraints
    attributes:
      label: Constraints
      options:
        - label: This must work with no account and no install.
        - label: This must work on a mid-range phone.
        - label: This must not require an API key.
        - label: This must not upload audio.