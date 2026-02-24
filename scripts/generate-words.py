import wordfreq

def generate_top_words(output_filename="../src/words.txt", target_count=10000):
    top_words = []
    
    # iter_wordlist yields words sorted from most common to least common
    print("Generating list...")
    for word in wordfreq.iter_wordlist('en'):
        # Keep only words between 3 and 7 letters that are strictly alphabetical 
        # (This filters out numbers, hyphenated words, or words with apostrophes)
        if 3 <= len(word) <= 7 and word.isalpha():
            top_words.append(word)
            
            # Stop grabbing words once we reach the target
            if len(top_words) == target_count:
                break
                
    # Save the results to a text file
    with open(output_filename, 'w', encoding='utf-8') as f:
        for word in top_words:
            f.write(f"{word}\n")
            
    print(f"\n--- Done! ---")
    print(f"Successfully generated {len(top_words)} words.")
    print(f"Saved to: {output_filename}")

if __name__ == "__main__":
    generate_top_words()