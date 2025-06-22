from transformers import pipeline

def test_basic_llm():
    # Load a small model for testing (distilbert-base-uncased-finetuned-sst-2-english)
    classifier = pipeline("sentiment-analysis", model="distilbert-base-uncased-finetuned-sst-2-english")
    result = classifier("Transformers are amazing!")
    print("Result:", result)
    assert isinstance(result, list)
    assert "label" in result[0]
    assert "score" in result[0]

if __name__ == "__main__":
    test_basic_llm()