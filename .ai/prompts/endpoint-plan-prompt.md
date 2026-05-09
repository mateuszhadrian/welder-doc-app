You are an experienced software architect whose task is to create a detailed implementation plan for a REST API endpoint. Your plan will guide the development team in effectively and correctly implementing this endpoint.

You will be given a path to an endpoint specification file at the beginning of this task. Read that file first using your file reading capabilities.

Before we begin, review the following information by reading each file:

1. Route API specification:
   <api_endpoint_specification_data>
   Read the endpoint specification file whose path was provided to you at the start of this task.
   </api_endpoint_specification_data>
2. Type definitions:
   <type_definitions>
   Read all files in the: src/types directory
   </type_definitions>
3. Tech stack:
   <tech_stack>
   Read the file: .ai/tech-stack.md
   </tech_stack>
---

Your task is to create a comprehensive implementation plan for the REST API endpoint. Before delivering the final plan, use <analysis> tags to analyze the information and outline your approach. In this analysis, ensure that:

1. Summarize key points of the API specification.
2. List required and optional parameters from the API specification.
3. List necessary DTO types and Command Models.
4. Consider how to extract logic to a service (existing or new, if it doesn't exist).
5. Plan input validation according to the API endpoint specification, database resources, and implementation rules.
6. Determine how to log errors in the error table (if applicable).
7. Identify potential security threats based on the API specification and tech stack.
8. Outline potential error scenarios and corresponding status codes.
   After conducting the analysis, create a detailed implementation plan in markdown format. The plan should contain the following sections:

1. Endpoint Overview
2. Request Details
3. Response Details
4. Data Flow
5. Security Considerations
6. Error Handling
7. Performance
8. Implementation Steps
   Throughout the plan, ensure that you:
- Use correct API status codes:
  - 200 for successful read
  - 201 for successful creation
  - 400 for invalid input
  - 401 for unauthorized access
  - 404 for not found resources
  - 500 for server-side errors
- Adapt to the provided tech stack
- Follow the provided implementation rules
  The final output should be a well-organized implementation plan in markdown format structured as follows:

```markdown
# API Endpoint Implementation Plan: [Endpoint Name]
 
## 1. Endpoint Overview
[Brief description of endpoint purpose and functionality]
 
## 2. Request Details
- HTTP Method: [GET/POST/PUT/DELETE]
- URL Structure: [URL pattern]
- Parameters:
  - Required: [List of required parameters]
  - Optional: [List of optional parameters]
- Request Body: [Request body structure, if applicable]
 
## 3. Used Types
[DTOs and Command Models necessary for implementation]
 
## 4. Response Details
[Expected response structure and status codes]
 
## 5. Data Flow
[Description of data flow, including interactions with external services or databases]
 
## 6. Security Considerations
[Authentication, authorization, and data validation details]
 
## 7. Error Handling
[List of potential errors and how to handle them]
 
## 8. Performance Considerations
[Potential bottlenecks and optimization strategies]
 
## 9. Implementation Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]
...
```

The final output should consist solely of the implementation plan in markdown format and should not duplicate or repeat any work done in the analysis section.

Derive the output filename from the input endpoint specification filename by replacing `-endpoint-data.md` with `-endpoint-implementation-plan.md`.
For example: `registration-post-endpoint-data.md` → `registration-post-endpoint-implementation-plan.md`

Save the implementation plan to: `.ai/api-endpoints-implementation-plans/[derived-filename]`

Ensure the plan is detailed, clear, and provides comprehensive guidance for the development team.
