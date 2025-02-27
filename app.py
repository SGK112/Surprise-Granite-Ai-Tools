@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    user_input = data.get("message", "")
    if not user_input:
        return jsonify({"error": "Missing user input"}), 400

    try:
        lower_input = user_input.lower()
        # Check if the input contains pricing-related keywords
        if any(keyword in lower_input for keyword in ["price", "cost", "estimate"]):
            try:
                pricing_data = get_pricing_data()
                pricing_summary = ", ".join([f"{mat.title()}: ${price}" for mat, price in pricing_data.items()])
                system_message = (
                    "You are a helpful remodeling assistant. "
                    "When answering pricing questions, refer to the following pricing data: " + pricing_summary + "."
                )
            except Exception as ex:
                system_message = "You are a helpful remodeling assistant."
                print("Error fetching pricing data:", ex)
        else:
            system_message = "You are a helpful remodeling assistant."
            
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_input}
            ]
        )
        return jsonify({"response": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
