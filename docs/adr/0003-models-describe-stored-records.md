# Models describe stored records

A collection's Zod model describes the record as persisted and read back. Parsed records must remain valid under the same model, allowing validation, defaults and normalisation such as string trimming without changing the stored representation on subsequent reads. Conversions between incompatible input and output representations belong in separate controller input schemas when controllers are introduced.
