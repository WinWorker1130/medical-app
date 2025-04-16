import json
import os
from anthropic import Anthropic
from datetime import datetime
import sys

def standardize_date(date_str: str) -> str:
    """Convert various date formats to MM-DD-YYYY format."""
    try:
        date_formats = [
            '%m/%d/%Y',  # 04/16/2019
            '%d/%m/%Y',  # 16/04/2019
            '%m-%d-%Y',  # 04-16-2019
            '%d-%m-%Y',  # 16-04-2019
            '%Y-%m-%d',  # 2019-04-16
            '%Y/%m/%d'   # 2019/04/16
        ]
        
        for fmt in date_formats:
            try:
                parsed_date = datetime.strptime(date_str, fmt)
                return parsed_date.strftime('%m-%d-%Y')
            except ValueError:
                continue
                
        raise ValueError(f"Unable to parse date: {date_str}")
        
    except Exception as e:
        return date_str

def read_ocr_file(file_path: str) -> str:
    """Read the OCR text file content."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return file.read()
    except Exception as e:
        return ""

def load_existing_timeline(timeline_path: str) -> list:
    """Load existing timeline JSON if it exists."""
    if os.path.exists(timeline_path):
        try:
            with open(timeline_path, 'r', encoding='utf-8') as file:
                return json.load(file)
        except json.JSONDecodeError:
            return []
    return []

def save_timeline(timeline_path: str, events: list) -> None:
    """Save the updated timeline to the file."""
    with open(timeline_path, 'w', encoding='utf-8') as f:
        json.dump(events, f, indent=2)

def generate_timeline(ocr_text_path: str) -> None:
    try:
        ocr_text = read_ocr_file(ocr_text_path)
        
        api_key = os.getenv('CLAUDE_API_KEY')
        if not api_key:
            raise ValueError("CLAUDE_API_KEY environment variable is not set")
            
        anthropic = Anthropic(api_key=api_key)
        
        system_prompt = """You are a medical document analyzer that outputs only JSON. Your task is to create a timeline of medical events from the provided document text. 
        Output ONLY a JSON array with no additional text or explanation.
        
        Required format:
        [
            {
                "date": "04-16-2019",  // Use format MM-DD-YYYY
                "title": "Accident",
                "description": "Detailed description of the event",
                "doctor": "Doctor's Name",
                "icon": "",  // Use exactly one icon that directly fits the description
                "pageNumber": 1  // Add the page number where this information was found
            }
        ]
        
        Use exactly ONE of these specific emojis based on the primary nature of the event:
        - Initial Injury/Accident: 💥
        - Surgery/Operation: 🏥
        - Doctor Consultation: 👨‍⚕️
        - Tests/Imaging/Labs: 🔬
        - Medication Changes: 💊
        - Physical Therapy/Rehabilitation: 🦾
        - Mental Health/Counseling: 🧠
        - Follow-up Visit: 📋
        - Treatment Plan/Care Plan: ⚕️
        - Recovery Milestone: ✅

        Choose the most appropriate single icon that best represents the primary purpose of the medical event. DO NOT use any icons not listed above. Include the page number where each event was found in the document. Output should start with '[' and end with ']'."""

        response = anthropic.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=4000,
            temperature=0,
            system=system_prompt,
            messages=[
                {"role": "user", "content": f"Create a timeline JSON array from this medical text (output only the JSON array): {ocr_text}"}
            ]
        )

        response_text = response.content[0].text.strip()
        start_index = response_text.find('[')
        end_index = response_text.rfind(']') + 1
        json_array = response_text[start_index:end_index]

        data = json.loads(json_array)

        # Add 'path="//"' to each item in the array
        updated_data = []
        for item in data:
            if isinstance(item, str):
                # For strings, prepend path="//"
                updated_data.append(f'path="{ocr_text_path}"{item}')
            elif isinstance(item, dict):
                # Add path key to dictionaries
                item['path'] = ocr_text_path
                updated_data.append(item)
            else:
                updated_data.append(item)  # Leave other types unchanged

        # Convert the updated data back to JSON string (if needed)
        updated_json_array = json.dumps(updated_data, indent=2)
        
        try:
            new_events = json.loads(json_array)
            
            for event in new_events:
                if 'date' in event:
                    event['date'] = standardize_date(event['date'])
                event['path'] = ocr_text_path
            
            # Load existing timeline
            timeline_path = timeline_path = os.path.join(
                os.path.dirname(ocr_text_path),
                'timeline.json'
            )
            existing_events = load_existing_timeline(timeline_path)
            
            # Merge and sort
            combined_events = existing_events + new_events
            combined_events.sort(
                key=lambda x: datetime.strptime(x['date'], '%m-%d-%Y') 
                if x.get('date') else datetime.max
            )
            
            # Save updated timeline
            save_timeline(timeline_path, combined_events)
            
            print(json.dumps({
                'status': 'success',
                'timeline_path': timeline_path,
                'new_events_count': len(new_events),
                'total_events_count': len(combined_events),
                'content': updated_json_array
            }))
            
        except json.JSONDecodeError as e:
            print(json.dumps({
                'status': 'error',
                # 'message': f'Failed to parse Claude response: {str(e)}'
                'message': f'Failed to parse Claude response: {json_array}'
            }))
            
    except Exception as e:
        print(json.dumps({
            'status': 'error',
            'message': str(e)
        }))

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({
            'status': 'error',
            'message': 'Please provide the OCR text file path'
        }))
        sys.exit(1)
    
    generate_timeline(sys.argv[1]) 
