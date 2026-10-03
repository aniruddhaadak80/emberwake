name: Bug report
description: Something in Emberwake does not work, or works incorrectly
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for filing this. If the problem is visible in the beacon's
        geometry, a screenshot is enormously helpful — a lopsided or gapped
        tower tells us a lot.

  - type: textarea
    id: what-happened
    attributes:
      label: What happened
      description: What did you observe?
      placeholder: The beacon looked fully lit but two people on the roster showed "left out".
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: What you expected instead
      placeholder: The overall score should have counted those two people.
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      value: |
        1.
        2.
        3.
    validations:
      required: true

  - type: textarea
    id: settings
    attributes:
      label: What did /settings show?
      description: >
        The Settings page reports the datastore adapter, engine version, agent
        tool count and daylight source status. Copy them here if you can.
      render: text

  - type: input
    id: device
    attributes:
      label: Device and browser
      placeholder: Pixel 8, Chrome 141 / iPhone 15, Safari 18 / Windows 11, Edge
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Console or network errors
      description: Browser console output and any failed request.
      render: text