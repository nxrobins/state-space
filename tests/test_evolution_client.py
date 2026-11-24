"""Offline compatibility check for the optional evolution dependency graph."""
import importlib.util
import json
import unittest


@unittest.skipUnless(importlib.util.find_spec('anthropic'), 'Install the evolution extra')
class EvolutionClientTests(unittest.TestCase):
    def test_message_request_and_response_through_installed_client(self):
        import anthropic
        import httpx2

        requests = []

        def respond(request):
            requests.append(json.loads(request.content))
            return httpx2.Response(200, json={
                'id': 'msg_offline', 'type': 'message', 'role': 'assistant',
                'model': 'offline-model', 'content': [{'type': 'text', 'text': 'offline response'}],
                'stop_reason': 'end_turn', 'stop_sequence': None,
                'usage': {'input_tokens': 1, 'output_tokens': 2},
            })

        transport = httpx2.MockTransport(respond)
        with anthropic.Anthropic(api_key='offline-test', max_retries=0,
                                 http_client=anthropic.DefaultHttpxClient(transport=transport)) as client:
            response = client.messages.create(model='offline-model', max_tokens=8,
                                              messages=[{'role': 'user', 'content': 'control'}])
        self.assertEqual(response.content[0].text, 'offline response')
        self.assertEqual(response.usage.model_dump()['output_tokens'], 2)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]['messages'], [{'role': 'user', 'content': 'control'}])
