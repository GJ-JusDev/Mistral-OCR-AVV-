import os
import sys
import subprocess
from plantuml import PlantUML
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

plantuml_server = PlantUML(url='http://www.plantuml.com/plantuml/img/')

# The updated class diagram with 'users' interconnecting the stray tables
class_diagram_puml = """@startuml
skinparam classAttributeIconSize 0

class users <<auth.users>> {
    - id: uuid [PK]
    - email: text
    - created_at: timestamptz
}

class schools {
    - id: uuid [PK]
    - name: text
    - school_id: text [UK]
    - division: text
    - region: text
    - is_active: boolean
    - created_at: timestamptz
}

class students {
    - id: uuid [PK]
    - lrn: text [UK]
    - first_name: text
    - middle_name: text
    - last_name: text
    - birth_date: date
    - sex: text
    - grade_level: text
    - school_id: uuid [FK]
    - status: text
    - created_at: timestamptz
    - updated_at: timestamptz
    + update_updated_at()
}

class documents {
    - id: uuid [PK]
    - student_id: uuid [FK]
    - uploaded_by: uuid [FK]
    - document_type: text
    - image_url: text
    - original_filename: text
    - extracted_text: text
    - extracted_fields: jsonb
    - ocr_model: text
    - ocr_confidence: real
    - status: text
    - created_at: timestamptz
    - updated_at: timestamptz
    + update_updated_at()
}

class validation_results {
    - id: uuid [PK]
    - document_id: uuid [FK]
    - rule_name: text
    - field_name: text
    - passed: boolean
    - expected_value: text
    - actual_value: text
    - message: text
    - created_at: timestamptz
}

class review_logs {
    - id: uuid [PK]
    - document_id: uuid [FK]
    - reviewed_by: uuid [FK]
    - action: text
    - previous_status: text
    - new_status: text
    - corrections: jsonb
    - comment: text
    - created_at: timestamptz
}

class user_roles {
    - id: uuid [PK]
    - user_id: uuid [FK]
    - role: user_role
    - created_at: timestamptz
}

class auth_logs {
    - id: uuid [PK]
    - user_id: uuid [FK]
    - action: text
    - ip_address: text
    - created_at: timestamptz
}

class teacher_invites {
    - id: uuid [PK]
    - email: text
    - access_code: text
    - created_at: timestamptz
    - used: boolean
}

users "1" -- "0..*" user_roles : has >
users "1" -- "0..*" auth_logs : generates >
teacher_invites "1" -- "1" users : registers >
users "1" -- "0..*" documents : uploads >
users "1" -- "0..*" review_logs : reviews >

schools "1" -- "0..*" students : contains >
students "1" -- "0..*" documents : uploads >
documents "1" -- "0..*" validation_results : yields >
documents "1" -- "0..*" review_logs : undergoes >
@enduml
"""

# Regenerate just the class diagram
puml_file = "class_diagram.puml"
png_file = "class_diagram.png"
with open(puml_file, 'w') as f:
    f.write(class_diagram_puml)
print(f"Generating {png_file}...")
plantuml_server.processes_file(puml_file, png_file)

# Now, open the existing DOCX and replace the class diagram explanation, OR re-generate the whole thing
# Since we have the whole script in generate_docx_plantuml.py, it's easier to modify it and run it.
