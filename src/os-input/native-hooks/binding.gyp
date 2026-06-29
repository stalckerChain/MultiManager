{
  "targets": [
    {
      "target_name": "hooks",
      "sources": ["hooks.cc"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": ["-luser32"]
          }
        ]
      ]
    }
  ]
}
