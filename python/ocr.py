import os
import fitz  # PyMuPDF
from datetime import datetime
import json
import sys
import anthropic
from PIL import Image
import io
import base64
from claude_summary import generate_medical_summary

sys.stdout.reconfigure(encoding='utf-8')

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=os.getenv('CLAUDE_API_KEY'))

def image_to_base64(image):
    """Convert PIL Image to base64 string"""
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def analyze_image_with_claude(image):
    """Analyze image using Claude Vision API"""
    try:
        base64_image = image_to_base64(image)
        message = client.messages.create(
            model="claude-3-opus-20240229",
            max_tokens=1000,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64_image
                        }
                    },
                    {
                        "type": "text",
                        "text": "Please extract and return all the text from this medical document image. Format it as plain text."
                    }
                ]
            }]
        )
        return message.content[0].text
    except Exception as e:
        print(f"Error in Claude Vision analysis: {str(e)}")
        return ""

def create_directory_structure(patient_name, file_name, base_folder='pdf/text'):
    """Create directory structure for patient and file"""
    try:
        file_name_without_ext = os.path.splitext(file_name)[0]
        os.makedirs(base_folder, exist_ok=True)
        patient_folder = os.path.join(base_folder, patient_name)
        os.makedirs(patient_folder, exist_ok=True)
        return patient_folder
    except Exception as e:
        raise

def extract_text_from_pdf(pdf_file_path, patient_name, original_filename, output_folder='pdf/text'):
    try:
        file_folder = create_directory_structure(patient_name, original_filename, output_folder)
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        base_name = os.path.splitext(original_filename)[0]
        unique_name = f"{base_name}_{timestamp}"
        
        text_file_path = os.path.join(file_folder, f"{unique_name}.txt")
        processed_pdf_path = os.path.join(file_folder, f"{unique_name}_processed.pdf")
        
        # Extract text from PDF
        pdf_document = fitz.open(pdf_file_path)
        pages_content = []
        
        for page_num in range(len(pdf_document)):
            try:
                page = pdf_document[page_num]
                page_text = page.get_text("text")
                
                # Check if page has extractable text
                if len(page_text.strip()) > 0:
                    # Use regular text extraction
                    pages_content.append({
                        'page_number': page_num + 1,
                        'content': page_text
                    })
                else:
                    # Convert page to image and use Claude Vision
                    pix = page.get_pixmap()
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    
                    # Use Claude Vision to analyze the image
                    extracted_text = analyze_image_with_claude(img)
                    
                    if extracted_text:
                        pages_content.append({
                            'page_number': page_num + 1,
                            'content': extracted_text
                        })
                    else:
                        pages_content.append({
                            'page_number': page_num + 1,
                            'content': "No text could be extracted from this page."
                        })
            except Exception as e:
                print(f"Error processing page {page_num + 1}: {str(e)}")
                continue
            
        # Write text content to file
        with open(text_file_path, 'w', encoding='utf-8') as text_file:
            for page in pages_content:
                text_file.write(f"\n=== PAGE {page['page_number']} START ===\n")
                text_file.write(page['content'])
                text_file.write(f"\n=== PAGE {page['page_number']} END ===\n")

        # Generate Claude summary
        summary_results = generate_medical_summary(text_file_path)

        # Modified result object to include summary
        result = {
            'status': 'success',
            'text_file': text_file_path,
            'processed_pdf': processed_pdf_path,
            'pages': [{
                'page_number': page['page_number'],
                'content': page['content'][:1000]  # Limit content size for JSON
            } for page in pages_content],
            'total_pages': len(pdf_document),
            'patient_folder': os.path.dirname(file_folder),
            'file_folder': file_folder,
            'medical_summary': summary_results.get('summary') if summary_results['status'] == 'success' else None
        }
        
        print(json.dumps(result))
        return
        
    except Exception as e:
        error_result = {
            'status': 'error',
            'message': str(e)
        }
        print(json.dumps(error_result))
        return

if __name__ == "__main__":
    if len(sys.argv) < 4:
        error_result = {
            'status': 'error',
            'message': 'Missing arguments. Required: pdf_path, patient_name, original_filename'
        }
        print(json.dumps(error_result))
        sys.exit(1)

    pdf_path = sys.argv[1]
    patient_name = sys.argv[2]
    original_filename = sys.argv[3]
    
    extract_text_from_pdf(pdf_path, patient_name, original_filename)