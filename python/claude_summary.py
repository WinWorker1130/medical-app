import anthropic
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def generate_medical_summary(input_text, context=None):
    """Generate medical summary from text file or direct message"""
    try:
        # Initialize Claude client
        claude = anthropic.Anthropic(api_key=os.getenv('CLAUDE_API_KEY'))
        
        # If input_text is a file path, read the file
        if os.path.exists(input_text):
            with open(input_text, 'r', encoding='utf-8') as file:
                content = file.read()
        else:
            # If it's a direct message, use it with context
            content = input_text
            if context:
                content = f"Context:\n{context}\n\nQuestion: {input_text}"

        # Create the prompt
        if context:
            prompt = f"Based on the provided medical context, please answer this question: {content}"
        else:
            prompt = f"""Please analyze this medical document and provide:
            1. Incident Summary:
               - Date and nature of incident
               - Initial medical response
               - Primary injuries

            2. Medical Timeline:
               - Chronological list of medical visits and procedures
               - Key diagnoses and treatments
               - Evolution of symptoms

            3. Current Medical Status:
               - Present symptoms and conditions
               - Recent diagnostic findings
               - Current treatment recommendations

            Here's the medical document:
            {content}

            Please format the response in clear sections with headers."""

        # Get response from Claude
        message = claude.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=4000,
            temperature=0,
            system="You are a medical document analysis assistant. Provide clear, structured summaries of medical documents.",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )

        return {
            "status": "success",
            "summary": message.content[0].text
        }

    except Exception as e:
        print(f"Error generating summary: {str(e)}")
        return {
            "status": "error",
            "error": str(e)
        }